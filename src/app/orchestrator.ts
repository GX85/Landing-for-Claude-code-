import type { Agent, Mode } from "./store";

export type StepStatus = "running" | "done" | "error";

export interface Step {
  id: number;
  agent: Agent;
  phase: string;
  status: StepStatus;
  text?: string;
  media?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export interface RunOptions {
  mode: Mode;
  agents: Agent[];
  leadId: string;
  rounds: number;
  signal: AbortSignal;
  onUpdate: (steps: Step[]) => void;
}

export interface RunOutcome {
  final?: Step;
  steps: Step[];
}

class Run {
  steps: Step[] = [];
  private nextId = 1;

  constructor(
    private task: string,
    private opts: RunOptions,
  ) {}

  private systemFor(agent: Agent): string {
    const team = this.opts.agents.map((a) => a.name).join(", ");
    return [
      `You are ${agent.name}, one member of a team of AI agents working together in the Focus harness (team: ${team}).`,
      "Work on the task you are given and reply with your result only, without meta commentary about the team.",
      agent.role.trim() ? `Your role: ${agent.role.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** Runs one agent call as a visible step. Resolves with the step, failed or not. */
  async call(agent: Agent, phase: string, prompt: string): Promise<Step> {
    const step: Step = { id: this.nextId++, agent, phase, status: "running", startedAt: Date.now() };
    this.steps.push(step);
    this.emit();
    try {
      const res = await fetch("api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent: { provider: agent.provider, model: agent.model, apiKey: agent.apiKey, baseUrl: agent.baseUrl, effort: agent.effort },
          system: this.systemFor(agent),
          prompt,
        }),
        signal: this.opts.signal,
      });
      const data = (await res.json().catch(() => ({}))) as { text?: string; media?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status}).`);
      step.status = "done";
      step.text = data.text ?? "";
      step.media = data.media;
    } catch (error) {
      step.status = "error";
      step.error = this.opts.signal.aborted ? "Stopped." : error instanceof Error ? error.message : String(error);
    }
    step.endedAt = Date.now();
    this.emit();
    return step;
  }

  emit(): void {
    this.opts.onUpdate([...this.steps]);
  }

  private checkStopped(): void {
    if (this.opts.signal.aborted) throw new DOMException("Stopped", "AbortError");
  }

  /** Everyone answers in parallel, then the lead merges the answers into one. */
  async council(): Promise<Step | undefined> {
    const answers = await Promise.all(this.opts.agents.map((a) => this.call(a, "Answer", this.task)));
    this.checkStopped();
    const good = answers.filter((s) => s.status === "done" && s.text);
    if (good.length <= 1) return good[0];

    const lead = this.opts.agents.find((a) => a.id === this.opts.leadId) ?? good[0].agent;
    const prompt = [
      `Task:\n${this.task}`,
      "Your teammates answered the task independently:",
      ...good.map((s) => `### ${s.agent.name}\n${s.text}`),
      "Write the single best final answer to the task. Combine the strongest points, fix mistakes and resolve disagreements. Reply with the final answer only.",
    ].join("\n\n");
    const merged = await this.call(lead, "Synthesis", prompt);
    return merged.status === "done" ? merged : good[0];
  }

  /** Agents work in order; each one improves and continues the previous result. */
  async relay(): Promise<Step | undefined> {
    let last: Step | undefined;
    for (const agent of this.opts.agents) {
      this.checkStopped();
      let prompt = this.task;
      if (last?.text) {
        prompt =
          agent.provider === "webhook"
            ? // tools such as video generators take the previous result as their prompt
              last.text
            : [
                `Task:\n${this.task}`,
                `The previous agent (${last.agent.name}) produced:\n\n${last.text}`,
                "Improve it: fix errors, fill gaps and continue the work. Reply with the complete improved result only.",
              ].join("\n\n");
      }
      const step = await this.call(agent, agent.provider === "webhook" ? "Generate" : last ? "Improve" : "Draft", prompt);
      if (step.status === "done") last = step;
    }
    return last;
  }

  /** The first agent drafts, the second reviews, the first revises — until approved. */
  async review(): Promise<Step | undefined> {
    const [maker, checker] = this.opts.agents;
    let draft = await this.call(maker, "Draft", this.task);
    if (draft.status !== "done" || !checker) return draft.status === "done" ? draft : undefined;

    for (let round = 1; round <= this.opts.rounds; round++) {
      this.checkStopped();
      const review = await this.call(
        checker,
        `Review ${round}`,
        [
          `Task:\n${this.task}`,
          `Draft from ${maker.name}:\n\n${draft.text}`,
          "Review the draft critically. If it fully solves the task with no real problems, reply with exactly APPROVED on the first line. Otherwise list the concrete problems to fix.",
        ].join("\n\n"),
      );
      if (review.status !== "done" || /^\s*\**APPROVED\b/i.test(review.text ?? "")) break;
      this.checkStopped();

      const revised = await this.call(
        maker,
        `Revision ${round}`,
        [
          `Task:\n${this.task}`,
          `Your draft:\n\n${draft.text}`,
          `Feedback from ${checker.name}:\n\n${review.text}`,
          "Revise the draft to address the feedback. Reply with the complete revised result only.",
        ].join("\n\n"),
      );
      if (revised.status !== "done") break;
      draft = revised;
    }
    return draft;
  }
}

export async function runTeam(task: string, opts: RunOptions): Promise<RunOutcome> {
  const run = new Run(task, opts);
  let final: Step | undefined;
  try {
    final = await run[opts.mode]();
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
  }
  return { final, steps: run.steps };
}
