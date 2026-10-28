# Focus

**Focus** is a harness that puts different models and agents to work as one team: Claude, GPT, Gemini and Grok
side by side, plus any OpenAI-compatible model, and video generators or autonomous agents (Manus, Jules…)
through an HTTP endpoint.

Live: https://focus-harness.vercel.app — landing at `/`, the harness at `/app`.

## How it works

- **Bring your own keys.** Keys are kept in the browser (`localStorage`) and sent with each call to the
  serverless proxy in `api/`, which calls the provider and returns the answer. Nothing is stored on the server.
- **Three team modes** (`src/app/orchestrator.ts`):
  - **Council** — every agent answers independently, then a lead agent merges the answers.
  - **Relay** — agents work top to bottom, each improving the previous result. An HTTP agent placed last
    (e.g. a video generator) gets the previous text as its prompt.
  - **Review** — the first agent drafts, the second reviews, the first revises, until approved or out of rounds.
- **Providers** (`api/_lib/providers.ts`): Anthropic (official SDK, with server-side refusal fallbacks on
  Claude 5-family models), OpenAI and xAI and any OpenAI-compatible endpoint (OpenAI SDK), Gemini
  (`@google/genai`), and generic HTTP agents.

### HTTP agents

Focus sends `POST <your URL>` with JSON `{ "task": "...", "system": "...", "model": "..." }` and an optional
`Authorization: Bearer <token>`. Reply with plain text, or JSON with any of `output` / `text` / `result`, and
optionally `video_url` / `image_url` / `url` — videos and images are shown inline. Use this to wrap video
generator APIs or autonomous agents behind a small endpoint of your own. Only public `https://` URLs are allowed.

## Develop

```bash
npm install
npm run dev      # landing + harness + the api/ functions on one dev server
npm run build    # typecheck + production build into dist/
```

Set `FOCUS_ALLOW_PRIVATE_URLS=1` to let custom/HTTP agents call `localhost` during development.

## Landing

- `index.html`, `src/style.css`, `src/main.ts` — the one-screen hero with the hairline-to-pill reveal (2.1 s,
  Web Animations). **Let's Focus** plays it in reverse and opens the harness.
- `?rec=1` — recording mode: reveal at 0 s, collapse at 4.9 s, 7 s loop; `window.__recVideo(t)` returns
  `(t mod duration) + 1/120`.
- Inter (variable, latin, 400–800) is self-hosted from `public/fonts` (SIL OFL, see `LICENSE-Inter.txt`).
