# Focus

**Focus** is a free AI assistant by Team Swift. It talks like a person, answers in about a second, and builds
games, websites, apps and presentations that run right in the chat. **Aeronus** is its team mode: Claude, GPT,
Gemini, Grok and other agents working on one task together.

Live: https://focus-agents.vercel.app (landing at `/`, the app at `/app`, both in English and Russian).

## The assistant

- **Three tiers**: **Storm** (fastest), **GEN** (everyday), **Clorus** (smartest, builds things). One chip in the
  message box opens the model sheet: tier, thinking level (Auto, Quick, Think, Deep, UltraVision) and your own
  agents.
- **Model routing** (`src/app/api.ts`): Ollama Cloud models run with the site's key first (gpt-oss 120B,
  Nemotron 3 Ultra and Super, Gemma 4 31B: first token in about a second), then free OpenRouter models, then
  keyless hosts. The message type picks the order: code goes to gpt-oss 120B, maths and logic to Nemotron 3 Ultra,
  stories and poems to Gemma 4. A model that fails is skipped for five minutes. The server tests which Ollama models
  the key really runs (`/api/models?ollama=1`, cached for 30 minutes), and only those are used and listed in
  Settings → Models.
- **Builder** (`src/app/builder.ts`): games (a tested engine plus the model's game code, with a repair loop),
  websites and apps (one HTML file, run in a sandbox and fixed until it starts without errors), presentations
  (JSON → designed deck with title, bullets, two-column, stats, quote, steps, timeline, chart, cards and compare
  slides; text shrinks to fit), and short animated films.
- **Attachments**: photos, PDFs, text and code files, and video (six frames go to a vision model).
- **Voice input**: the browser's speech recognition; where it is missing or broken, Focus records the voice and
  `/api/transcribe` turns it into text.
- **Tools** (Settings → Devices): web search and page reading with sources, location, and the device bridge.

## Aeronus

Switched on in Settings → General. Eight ways to work (`src/app/modes.ts`): Solo, Compare, Council, Vote, Debate,
Relay, Review and Planner. Members are your agents (Agents page) on your own keys (Connections page): Anthropic,
OpenAI, Gemini, xAI, Mistral, Qwen, OpenRouter, Ollama, any OpenAI-compatible endpoint, and autonomous agents such
as Manus, Jules and Devin.

## Device bridge

`public/focus-bridge.mjs` (Node 18+, also runs in Termux on Android) lets Focus work with your computer or phone:
find and read files in one folder, open links, files and apps, use the clipboard, show notifications, type into the
open window, take screenshots and, with `--shell`, run commands. It listens only on `127.0.0.1`, needs a key, and
every action is approved by you in Focus.

```
node focus-bridge.mjs                 # your home folder
node focus-bridge.mjs --root ~/Documents --shell
node focus-bridge.mjs --no-control    # files only
```

## Accounts and access

- An access key opens the app (the landing stays public). Wrong keys are slowed down and locked out after five tries.
- Sign-in with GitHub, Google or an emailed code. Settings → General → Account: name, picture, colour, "about you"
  (Focus uses it in answers) and the accounts used on this device.
- Chats and settings are stored in the browser (`localStorage`).

## Server settings (Vercel environment variables)

| Variable | What it does |
| --- | --- |
| `AUTH_SECRET` | Signs sessions and access cookies. Required for the access key and sign-in. |
| `FOCUS_ACCESS_CODE` | The key that opens the app. |
| `FOCUS_OLLAMA_KEY` | Ollama Cloud key: the main, fast models. |
| `FOCUS_OPENROUTER_KEY` | OpenRouter key for free `:free` models and voice transcription. |
| `FOCUS_GROQ_KEY`, `FOCUS_GEMINI_KEY`, `FOCUS_CEREBRAS_KEY`, `FOCUS_MISTRAL_KEY`, `FOCUS_SAMBANOVA_KEY` | Optional free-tier keys: more messages a day, and Groq/Gemini also transcribe voice. |
| `FOCUS_POLLINATIONS_KEY` | Optional: more reliable Focus Image. |
| `FOCUS_TAVILY_KEY` or `FOCUS_BRAVE_KEY` | Optional: better web search. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub sign-in. Callback: `https://<site>/api/auth?a=github-callback` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in. Callback: `https://<site>/api/auth?a=google-callback` |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email codes. Without a verified domain, Resend only delivers to its own account's address. |

## Develop

```
npm install
npm run dev        # http://localhost:5173, the /api routes run in the dev server
npx tsc --noEmit   # type check
npm run build
```

`VITE_ARTIFACT=1 npx vite build --base=./` builds a copy that runs without a server (chats go through Claude, the
app is behind a key checked in the page).

## Layout

- `index.html`, `src/landing.ts`, `src/sections.ts`, `src/*.css` — the landing.
- `src/app/` — the app: `chat.ts` (chat and composer), `api.ts` (routing and calls), `builder.ts` and
  `templates/` (things Focus builds), `modes.ts` (Aeronus), `settings.ts`, `account.ts`, `tools.ts`, `voice.ts`.
- `src/i18n.ts`, `src/i18n-ru.ts` — the Russian translation.
- `api/` — Vercel functions: `run` (chat), `models`, `job` and `media` (generators), `auth`, `web`, `transcribe`.
