# Focus

**Focus** puts different AI models and agents to work as one team, in a chat that feels like ChatGPT or Claude:
Claude, GPT, Gemini and Grok side by side, plus any OpenAI-compatible model, and video generators or autonomous
agents (Manus, Jules…) through an HTTP endpoint.

Live: https://focus-agents.vercel.app — the landing at `/`, the app at `/app`. Both are one page: **Let's Focus**
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

## Models, generators and agents

- **Focus (free)** — built in, no key: chat on an open model (GPT-OSS 20B via Pollinations' anonymous tier) and
  **Focus Image** (one free picture every 45 seconds). New users can chat right away. If the server has
  `FOCUS_POLLINATIONS_KEY`, the built-in model uses it for more models and higher limits.
- **Free with an account / on your machine** — **OpenRouter** (free models end in `:free`, listed first) and
  **Ollama** (models on your own computer; the browser talks to it directly, start it with `OLLAMA_ORIGINS=*`).
- **Chat models** — Anthropic (official SDK, refusal fallbacks on Claude 5-family models), OpenAI, Gemini, xAI,
  any OpenAI-compatible endpoint.
- **Image & video generators** — Gemini (Imagen, Veo), OpenAI images, Pollinations (dozens of video and image
  models with one key), Luma Dream Machine, Replicate (any `owner/name` model).
- **Autonomous agents** — Manus, Google Jules (works in a GitHub repo and opens a pull request), Devin, and any
  HTTP endpoint of your own.

Each agent has a **type**: chat, image, video or autonomous agent. Media and agent jobs run through `/api/job`:
`start` kicks one off and the browser polls until it finishes, so long renders and hour-long agent tasks don't
depend on one serverless call. Files that need the key to download (Veo, Replicate, Pollinations) stream through
`/api/media`.

In **Relay**, an image/video/agent placed after chat agents gets the previous agent's text as its prompt — e.g.
Claude writes a scene, Veo renders it. **Planner** can hand subtasks to generators and agents too.

## Attachments

Images (PNG, JPEG, WebP, GIF — downscaled in the browser), PDFs (text extracted in the browser with pdf.js) and
text/code files. Attach with the paperclip, drag and drop, or paste. Images go to vision models natively (Claude,
GPT, Gemini, Grok, OpenRouter, Ollama) and serve as the start frame for video models that take one.

## How it works

- **Bring your own keys.** Keys are kept in the browser (`localStorage`) and sent with each call to the serverless
  proxy in `api/`, which calls the provider and streams the answer back as NDJSON. Nothing is stored on the server.

### HTTP agents

Focus sends `POST <your URL>` with JSON `{ "task": "...", "system": "...", "model": "...", "history": [...],
"images": ["data:image/png;base64,…"] }` and an optional `Authorization: Bearer <token>`. Reply with plain text,
or JSON with any of `output` / `text` / `result`, and optionally `video_url` / `image_url` / `url` — videos and
images are shown inline. Only public `https://` URLs are allowed.

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
