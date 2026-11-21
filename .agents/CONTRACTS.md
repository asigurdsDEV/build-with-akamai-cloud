# Contracts

The interfaces between parts of Cue. Agents must not break these without a decision record. Source of truth: `shared/cue.ts` (decision 001).

## Modules

| Module | Folder | Owner | Talks to |
|--------|--------|-------|----------|
| Shared types, prompts, output check (pure) | `shared/cue.ts` | claude@aiden | used by app and server |
| Server + API | `server/index.ts` | claude@aiden | Akamai Cloud Inference, Akamai Object Storage |
| Capture (mic captions, screen, tab audio) | `app/capture.ts` | claude@aiden | browser APIs |
| UI | `app/App.tsx`, `app/style.css` | claude@aiden | server API |
| Mac app shell | `desktop/` | claude@aiden | loads the UI in a WKWebView; bridge below |

## API (app → server)

- `GET /api/status` → `{ ai, vision, stt, storage }` (what the server has configured).
- `POST /api/ask` `{ mode: "say" | "screen" | "summary" | "followups" | "ask", question?, lines: Line[], image?: JPEG data URL }` → the answer as streamed plain text. The app runs `checkAnswer()` when it ends.
- `POST /api/transcribe` raw `audio/webm` body (≤ 8 MB) → `{ text }`. `503` if no speech model.
- `POST /api/recap` `{ lines: Line[] }` → `SavedRecap` (`id` is `""` when Object Storage isn't configured).
- `GET /api/recap/<uuid>` → `SavedRecap`, `404` if missing.
- Errors: JSON `{ error }` with a status code. `503` = that part isn't configured.

## Shared data formats

- `Line { who: "you" | "them", text, at }`, `Check`, `Recap`, `SavedRecap`: see `shared/cue.ts`.
- Object Storage key: `recaps/<uuid>.json` holding a `SavedRecap`.
- Env vars: see `.env.example`. Never commit real values.

## Cue.app bridge (page ↔ native)

- Page → native: `webkit.messageHandlers.cue.postMessage({ type })` with `hide`, `listen` (`on: boolean`), `frame` (`id: number`).
- Native → page: `window.__cue.caption(final, interim)`, `window.__cue.frame(id, jpegDataUrl | "")`, `window.__cue.error(message)`, `window.__cueFocus()`.
- The app bundles `dist/`, `server/`, `shared/` and `aws4fetch` in `Contents/Resources/web` and runs the server from there. Settings: `~/Library/Application Support/Cue/cue.env`.
