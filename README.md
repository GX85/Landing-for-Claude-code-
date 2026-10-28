# Focus

**Focus** puts different AI models and agents to work as one team, in a chat that feels like ChatGPT or Claude:
Claude, GPT, Gemini and Grok side by side, plus any OpenAI-compatible model, and video generators or autonomous
agents (Manus, Jules…) through an HTTP endpoint.

Live: https://focus-harness.vercel.app — the landing at `/`, the app at `/app`. Both are one page: **Let's Focus**
collapses the hero and opens the app without a reload.

## The app

- **Chats** — history in the sidebar (search, rename, delete), streamed answers rendered as Markdown, follow-up
  questions with full context, regenerate, stop, copy, export a chat as Markdown, text-file attachments.
- **Eight modes** (`src/app/modes.ts`), picked in the message box:
  - **Solo** — one-on-one chat with the agent you pick.
  - **Compare** — every agent answers; answers side by side.
  - **Council** — every agent answers, the lead merges them.
  - **Vote** — every agent answers, the judge picks the best and says why.
  - **Debate** — agents argue over N rounds, the judge gives a verdict.
  - **Relay** — agents work in order, each improving the last; an HTTP agent placed last (e.g. a video generator)
    gets the previous text as its prompt.
  - **Review** — the author drafts, a reviewer critiques, the author revises until approved.
  - **Planner** — the lead splits the task into subtasks, agents work in parallel, the lead assembles the result.
- **Agents** — name, model, role (with presets), color, order; several agents can share one model.
- **Connections** — API keys per provider, with a Test button that lists the models the key can use.
- **Modes** — what each mode does, with a shortcut to start a chat in it.

## How it works

- **Bring your own keys.** Keys are kept in the browser (`localStorage`) and sent with each call to the serverless
  proxy in `api/`, which calls the provider and streams the answer back as NDJSON. Nothing is stored on the server.
- **Providers** (`api/_lib/providers.ts`): Anthropic (official SDK, with server-side refusal fallbacks on Claude
  5-family models), OpenAI, xAI and any OpenAI-compatible endpoint (OpenAI SDK), Gemini (`@google/genai`), and
  generic HTTP agents.

### HTTP agents

Focus sends `POST <your URL>` with JSON `{ "task": "...", "system": "...", "model": "...", "history": [...] }`
and an optional `Authorization: Bearer <token>`. Reply with plain text, or JSON with any of `output` / `text` /
`result`, and optionally `video_url` / `image_url` / `url` — videos and images are shown inline. Use this to wrap
video generator APIs or autonomous agents behind a small endpoint of your own. Only public `https://` URLs are
allowed.

## Develop

```bash
npm install
npm run dev      # landing + app + the api/ functions on one dev server
npm run build    # typecheck + production build into dist/
```

Set `FOCUS_ALLOW_PRIVATE_URLS=1` to let custom/HTTP agents call `localhost` during development.

## Landing

- `index.html`, `src/style.css`, `src/landing.ts` — the one-screen hero with the hairline-to-pill reveal (2.1 s,
  Web Animations). **Let's Focus** plays it in reverse and opens the app. `src/main.ts` routes between the two.
- `?rec=1` — recording mode: reveal at 0 s, collapse at 4.9 s, 7 s loop; `window.__recVideo(t)` returns
  `(t mod duration) + 1/120`.
- Inter (variable, latin, 400–800) is self-hosted from `public/fonts` (SIL OFL, see `LICENSE-Inter.txt`).
