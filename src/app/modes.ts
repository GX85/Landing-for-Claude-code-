import { callAgent, runJob, type ChatTurn, type ImagePart } from "./api";
import { typingTick } from "./sound";
import type { Agent, Connection, ModeId, Skill, StepRecord } from "./store";

export interface ModeInfo {
  id: ModeId;
  name: string;
  short: string;
  description: string;
  steps: string[];
  /** Lets the user pick which agent leads (answers, merges, judges or plans). */
  leadLabel?: string;
  rounds?: boolean;
  minAgents: number;
  icon: string;
}

export const MODES: ModeInfo[] = [
  {
    id: "solo",
    name: "Solo",
    short: "Chat with one agent",
    description: "A plain one-on-one chat with the agent you pick — the quickest way to ask something.",
    steps: ["The chosen agent answers directly."],
    leadLabel: "Agent",
    minAgents: 1,
    icon: "solo",
  },
  {
    id: "compare",
    name: "Compare",
    short: "Side-by-side answers",
    description: "Every agent answers the same message on its own, and you see the answers side by side.",
    steps: ["All agents answer in parallel.", "Answers are shown next to each other."],
    minAgents: 2,
    icon: "compare",
  },
  {
    id: "council",
    name: "Council",
    short: "Answers merged into one",
    description: "Every agent answers on its own, then the lead merges the strongest points into a single answer.",
    steps: ["All agents answer in parallel.", "The lead merges the answers, fixing mistakes and resolving disagreements."],
    leadLabel: "Lead",
    minAgents: 2,
    icon: "council",
  },
  {
    id: "vote",
    name: "Vote",
    short: "A judge picks the best",
    description: "Every agent answers, then the judge reads them all, picks the best one and says why.",
    steps: ["All agents answer in parallel.", "The judge compares them and picks a winner."],
    leadLabel: "Judge",
    minAgents: 2,
    icon: "vote",
  },
  {
    id: "debate",
    name: "Debate",
    short: "Agents argue, a judge decides",
    description: "Agents argue the question over several rounds, answering each other's points, then the judge gives the verdict.",
    steps: ["Each debater states a position.", "In each round they rebut the others.", "The judge weighs the arguments and gives a verdict."],
    leadLabel: "Judge",
    rounds: true,
    minAgents: 2,
    icon: "debate",
  },
  {
    id: "relay",
    name: "Relay",
    short: "Each agent builds on the last",
    description: "Agents work in order: each one improves and continues the previous result. Put a video generator last to turn the text into a clip.",
    steps: ["The first agent drafts.", "Each next agent improves and continues the work."],
    minAgents: 2,
    icon: "relay",
  },
  {
    id: "review",
    name: "Review",
    short: "Draft, review, revise",
    description: "The author drafts, a reviewer critiques it, and the author revises — until the reviewer approves.",
    steps: ["The author drafts.", "The reviewer lists problems or approves.", "The author revises, for up to N rounds."],
    leadLabel: "Author",
    rounds: true,
    minAgents: 2,
    icon: "review",
  },
  {
    id: "planner",
    name: "Planner",
    short: "Split the task, work in parallel",
    description: "The lead breaks the task into subtasks and hands them out, the team works on them in parallel, and the lead assembles the result.",
    steps: ["The lead writes a plan and assigns subtasks.", "Agents do their subtasks in parallel.", "The lead assembles the final result."],
    leadLabel: "Lead",
    minAgents: 2,
    icon: "planner",
  },
];

export const modeInfo = (id: ModeId) => MODES.find((m) => m.id === id) ?? MODES[0];

export interface RunContext {
  mode: ModeId;
  /** The user's message, attachments included. */
  task: string;
  /** Earlier turns of this chat. */
  history: ChatTurn[];
  /** Images the user attached to this message. */
  images: ImagePart[];
  agents: Agent[];
  lead: Agent;
  rounds: number;
  connectionOf: (agent: Agent) => Connection;
  /** Every skill an agent could have, built-in and the user's own. */
  skills: Skill[];
  signal: AbortSignal;
  /** Called whenever a step starts, streams or ends. */
  onChange: () => void;
}

export interface RunOutcome {
  final?: StepRecord;
  note?: string;
}

class Run {
  steps: StepRecord[] = [];
  private nextId = 1;

  /** Agents that can reason in text: they lead, judge, review and debate. */
  private thinkers: Agent[];

  constructor(private ctx: RunContext) {
    this.thinkers = ctx.agents.filter((a) => a.kind === "chat");
  }

  private system(agent: Agent): string {
    const today = `Today is ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`;
    // a Focus tier carries its whole personality in its role
    if (agent.model.startsWith("tier:")) return [agent.role, today].join("\n\n");
    const team = this.ctx.agents.map((a) => a.name).join(", ");
    return [
      this.ctx.agents.length > 1
        ? `You are ${agent.name}, one member of a team of AI agents working together in Focus (team: ${team}).`
        : `You are ${agent.name}, an AI assistant in Focus.`,
      "Reply with your result only, without meta commentary about the team. Use Markdown when it helps readability.",
      "Reply in the user's language. Sound like a sharp, warm human expert: direct, honest about uncertainty, no filler or corporate phrases, a light touch of humour only when it fits.",
      today,
      agent.role.trim() ? `Your role: ${agent.role.trim()}` : "",
      ...this.ctx.skills.filter((s) => agent.skills?.includes(s.id) && s.instructions.trim()).map((s) => `Skill — ${s.name}: ${s.instructions.trim()}`),
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** One agent call shown as a step. Resolves with the step whether it worked or not. */
  async call(agent: Agent, phase: string, prompt: string, withImages = true): Promise<StepRecord> {
    const step: StepRecord = {
      id: this.nextId++,
      agentId: agent.id,
      agentName: agent.name,
      avatar: agent.avatar,
      provider: this.ctx.connectionOf(agent)?.provider,
      color: agent.color,
      phase,
      status: "running",
      text: "",
      startedAt: Date.now(),
    };
    this.steps.push(step);
    this.ctx.onChange();
    const images = withImages ? this.ctx.images : [];
    try {
      const result =
        agent.kind === "chat"
          ? await callAgent(
              agent,
              this.ctx.connectionOf(agent),
              this.system(agent),
              [...this.ctx.history, { role: "user", content: prompt, ...(images.length ? { images } : {}) }],
              this.ctx.signal,
              (text) => {
                if (text.length > step.text.length) typingTick();
                step.text = text;
                this.ctx.onChange();
              },
            )
          : await runJob(agent, this.ctx.connectionOf(agent), prompt, images, this.ctx.signal, (progress) => {
              step.progress = progress;
              this.ctx.onChange();
            });
      Object.assign(step, { status: "done", text: result.text, media: result.media, model: result.model, usage: result.usage, progress: undefined });
    } catch (error) {
      step.status = "error";
      step.error = this.ctx.signal.aborted ? "Stopped." : error instanceof Error ? error.message : String(error);
    }
    step.endedAt = Date.now();
    this.ctx.onChange();
    return step;
  }

  private stopIfAborted(): void {
    if (this.ctx.signal.aborted) throw new DOMException("Stopped", "AbortError");
  }

  private get task() {
    return this.ctx.task;
  }

  private all(phase: string) {
    return Promise.all(this.ctx.agents.map((a) => this.call(a, phase, this.task)));
  }

  private others(agent: Agent) {
    return this.thinkers.filter((a) => a.id !== agent.id);
  }

  /** The lead, or the first agent that can reason in text. */
  private get lead(): Agent {
    return this.ctx.lead.kind === "chat" ? this.ctx.lead : (this.thinkers[0] ?? this.ctx.lead);
  }

  async solo(): Promise<RunOutcome> {
    const lead = this.ctx.lead;
    const step = await this.call(lead, lead.kind === "chat" ? "Answer" : lead.kind === "agent" ? "Task" : `Make ${lead.kind}`, this.task);
    return { final: step.status === "done" ? step : undefined };
  }

  async compare(): Promise<RunOutcome> {
    await this.all("Answer");
    return {};
  }

  async council(): Promise<RunOutcome> {
    const answers = await this.all("Answer");
    const good = answers.filter((s) => s.status === "done" && s.text && !s.media);
    this.stopIfAborted();
    if (good.length <= 1) return { final: good[0] ?? answers.find((s) => s.status === "done") };
    const merged = await this.call(
      this.lead,
      "Merge",
      [
        `Task:\n${this.task}`,
        "Your teammates answered the task independently:",
        ...good.map((s) => `### ${s.agentName}\n${s.text}`),
        "Write the single best final answer to the task. Combine the strongest points, fix mistakes and resolve disagreements. Reply with the final answer only.",
      ].join("\n\n"),
    );
    return { final: merged.status === "done" ? merged : good[0] };
  }

  async vote(): Promise<RunOutcome> {
    const answers = await this.all("Answer");
    const good = answers.filter((s) => s.status === "done" && (s.text || s.media));
    this.stopIfAborted();
    if (good.length <= 1) return { final: good[0] };
    const verdict = await this.call(
      this.lead,
      "Judge",
      [
        `Task:\n${this.task}`,
        "Candidate answers:",
        ...good.map((s, i) => `### Answer ${i + 1}\n${s.text || "(a generated image or video — you can't see it; judge the text answers)"}`),
        `Pick the best answer. Reply with "WINNER: <number>" on the first line, then one short paragraph explaining why it beats the others.`,
      ].join("\n\n"),
    );
    const n = Number(/WINNER:\s*\**\s*(\d+)/i.exec(verdict.text)?.[1]);
    const winner = good[n - 1] ?? good[0];
    const why = verdict.text.replace(/^.*WINNER:[^\n]*\n?/i, "").trim();
    return { final: winner, note: verdict.status === "done" ? `${verdict.agentName} picked ${winner.agentName}'s answer. ${why}`.trim() : undefined };
  }

  async debate(): Promise<RunOutcome> {
    const judge = this.lead;
    const debaters = this.others(judge).length >= 2 ? this.others(judge) : this.thinkers;
    let last = await Promise.all(
      debaters.map((d) =>
        this.call(d, "Opening", `Question for debate:\n${this.task}\n\nState your position clearly and make your strongest case. Be concise.`),
      ),
    );
    const transcript: string[] = last.filter((s) => s.status === "done").map((s) => `**${s.agentName} (opening):** ${s.text}`);

    for (let round = 1; round <= this.ctx.rounds; round++) {
      this.stopIfAborted();
      const said = last.filter((s) => s.status === "done");
      if (said.length < 2) break;
      last = await Promise.all(
        debaters.map((d) =>
          this.call(
            d,
            `Round ${round}`,
            [
              `Question for debate:\n${this.task}`,
              `The debate so far:\n\n${transcript.join("\n\n")}`,
              "Answer the other debaters: rebut weak points, concede valid ones and strengthen your position. Be concise.",
            ].join("\n\n"),
          ),
        ),
      );
      transcript.push(...last.filter((s) => s.status === "done").map((s) => `**${s.agentName} (round ${round}):** ${s.text}`));
    }
    this.stopIfAborted();
    if (!transcript.length) return {};
    const verdict = await this.call(
      judge,
      "Verdict",
      [
        `Question:\n${this.task}`,
        `Debate transcript:\n\n${transcript.join("\n\n")}`,
        "You are the judge. Weigh the arguments fairly, say which points held up, and give your final answer to the question.",
      ].join("\n\n"),
    );
    return { final: verdict.status === "done" ? verdict : undefined };
  }

  async relay(): Promise<RunOutcome> {
    let last: StepRecord | undefined;
    for (const agent of this.ctx.agents) {
      this.stopIfAborted();
      // tools such as video generators and autonomous agents take the previous result as their prompt
      const webhook = agent.kind !== "chat" || this.ctx.connectionOf(agent).provider === "webhook";
      const prompt = !last
        ? this.task
        : webhook
          ? last.text
          : [
              `Task:\n${this.task}`,
              `The previous agent (${last.agentName}) produced:\n\n${last.text}`,
              "Improve it: fix errors, fill gaps and continue the work. Reply with the complete improved result only.",
            ].join("\n\n");
      const phase = agent.kind === "image" || agent.kind === "video" ? `Make ${agent.kind}` : agent.kind === "agent" ? "Task" : webhook ? "Generate" : last ? "Improve" : "Draft";
      const step = await this.call(agent, phase, prompt, !last);
      if (step.status === "done") last = step;
    }
    return { final: last };
  }

  async review(): Promise<RunOutcome> {
    const author = this.lead;
    const reviewer = this.others(author)[0];
    let draft = await this.call(author, "Draft", this.task);
    if (draft.status !== "done") return {};
    if (!reviewer) return { final: draft };

    for (let round = 1; round <= this.ctx.rounds; round++) {
      this.stopIfAborted();
      const review = await this.call(
        reviewer,
        `Review ${round}`,
        [
          `Task:\n${this.task}`,
          `Draft from ${author.name}:\n\n${draft.text}`,
          "Review the draft critically. If it fully solves the task with no real problems, reply with exactly APPROVED on the first line. Otherwise list the concrete problems to fix.",
        ].join("\n\n"),
      );
      if (review.status !== "done") break;
      if (/^\s*\**APPROVED\b/i.test(review.text)) return { final: draft, note: `${reviewer.name} approved the draft after ${round === 1 ? "one review" : `${round} reviews`}.` };
      this.stopIfAborted();
      const revised = await this.call(
        author,
        `Revision ${round}`,
        [
          `Task:\n${this.task}`,
          `Your draft:\n\n${draft.text}`,
          `Feedback from ${reviewer.name}:\n\n${review.text}`,
          "Revise the draft to address the feedback. Reply with the complete revised result only.",
        ].join("\n\n"),
      );
      if (revised.status !== "done") break;
      draft = revised;
    }
    return { final: draft };
  }

  async planner(): Promise<RunOutcome> {
    const lead = this.lead;
    const team = this.ctx.agents;
    const can = (a: Agent) => (a.kind === "chat" ? "" : a.kind === "agent" ? " [autonomous agent: give it a self-contained task]" : ` [makes ${a.kind}s: give it a visual prompt]`);
    const plan = await this.call(
      lead,
      "Plan",
      [
        `Task:\n${this.task}`,
        `Your team: ${team.map((a) => `${a.name}${can(a)}${a.role ? ` (${a.role.slice(0, 80)})` : ""}`).join("; ")}.`,
        'Split the task into 2–5 independent subtasks that can be done in parallel and assign each to one teammate by name. Reply with JSON only, in this shape: [{"agent": "Name", "task": "what to do"}]',
      ].join("\n\n"),
    );
    this.stopIfAborted();
    if (plan.status !== "done") return {};

    let items: { agent?: string; task?: string }[] = [];
    try {
      const match = /\[[\s\S]*\]/.exec(plan.text);
      items = match ? (JSON.parse(match[0]) as typeof items) : [];
    } catch {
      items = [];
    }
    items = items.filter((i) => typeof i.task === "string" && i.task.trim()).slice(0, 6);
    if (!items.length) items = team.map((a) => ({ agent: a.name, task: this.task }));

    const results = await Promise.all(
      items.map((item, i) => {
        const agent = team.find((a) => a.name.toLowerCase() === item.agent?.toLowerCase()) ?? team[i % team.length];
        const prompt = agent.kind === "chat" ? `Overall task:\n${this.task}\n\nYour part:\n${item.task}\n\nDo only your part, thoroughly.` : item.task!;
        return this.call(agent, `Subtask ${i + 1}`, prompt).then((step) => ({ item, step }));
      }),
    );
    this.stopIfAborted();
    const done = results.filter((r) => r.step.status === "done");
    if (!done.length) return {};
    const final = await this.call(
      lead,
      "Assemble",
      [
        `Task:\n${this.task}`,
        "Your team finished these parts:",
        ...done.map((r, i) => `### Part ${i + 1}: ${r.item.task} (by ${r.step.agentName})\n${r.step.text || "(delivered a generated file, shown to the user separately)"}`),
        "Assemble the parts into one complete, coherent final result. Reply with the final result only.",
      ].join("\n\n"),
    );
    return { final: final.status === "done" ? final : done.at(-1)!.step };
  }
}

/** Runs one turn of a chat in the given mode. `steps` fills in as agents work. */
export function startRun(ctx: RunContext): { steps: StepRecord[]; done: Promise<RunOutcome> } {
  const run = new Run(ctx);
  const done = run[ctx.mode]().catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") return {};
    throw error;
  });
  return { steps: run.steps, done };
}
