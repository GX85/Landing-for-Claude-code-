# Focus — hero

One-screen landing for **Focus** — a harness that puts different models and agents to work together:
Claude, GPT, Gemini and Grok side by side, plus video generators and autonomous agents such as Manus or Jules.

Vite + TypeScript, vanilla JS, no framework.

```bash
npm install
npm run dev      # local dev server
npm run build    # typecheck + production build into dist/
```

- `index.html` — markup, `src/style.css` — styles, `src/main.ts` — Web Animations reveal timeline (2.1 s).
- **Let's Focus** plays the timeline in reverse down to the hairline, then opens it again.
- `?rec=1` — recording mode: reveal at 0 s, collapse at 4.9 s, 7 s loop; `window.__recVideo(t)` returns `(t mod duration) + 1/120`.
- `prefers-reduced-motion` shows the final state with the video paused.
- Inter (variable, latin, 400–800) is self-hosted from `public/fonts` (SIL OFL, see `LICENSE-Inter.txt`).
