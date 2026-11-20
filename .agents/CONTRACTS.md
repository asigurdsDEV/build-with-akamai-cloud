# Contracts

The interfaces between parts of the game. Agents must not break these without a decision record. Source of truth: `shared/types.ts` (decision 001).

## Modules

| Module | Folder | Owner | Talks to |
|--------|--------|-------|----------|
| Shared types | `shared/` | everyone (decision record to change) | all |
| Game engine (pure) | `game/engine.ts` | | nothing; takes Commands, returns GameState |
| Content (personas, tactics, scenarios, timings) | `game/content.ts` | | read by engine + voice |
| Voice (prompts, model-answer parsing, scripted lines) | `game/voice.ts` | | read by server (prompts) and app (fallback) |
| Model server | `server/` | | OpenAI-compatible model endpoint |
| App: director (clock, who speaks when) + UI | `app/` | | engine via Commands, server via `/api/line` |

## Shared data formats

- `GameState`, `Character`, `Post`, `Clue`, `Ejection`, `Scenario`: see `shared/types.ts`.
- Character `role` and `tactics` are hidden: the UI shows them only after ejection or game over.
- `Post.to` set = a DM between the player and that character (both directions use the character's id).
- Model answers: JSON `{"text": "...", "cited": "source or null"}`; `parseLine()` turns it into a `say` command and fills the Source Check verdict.

## Events / messages between modules

- `Command` (UI/director → engine): `tick`, `post` (player), `say` (character), `use_tool`, `call_meeting`, `vote`.
- `POST /api/line` (app → server): body `{ state, charId, kind: "post" | "reply" | "defense", to? }` → a `say` Command. `503` = no model configured; the app falls back to scripted lines.
- Env vars (server only, never committed): `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `PORT`.
