# Status — Aiden

Only you and your agent edit this file. Everyone else reads it. Update it every time your agent starts or finishes something.

**Human:** Aiden
**Agent:** Claude Code
**Branch:** aiden/game-skeleton
**Last updated:** 2026-11-20 10:31

## Working on right now

## Files / folders I'm touching (hands off)

## Just finished
- Playable skeleton of Who's the Bot? (PR from aiden/game-skeleton): pure engine (`game/engine.ts`, 10 tests), content from Sarah's doc, character prompts + scripted fallback (`game/voice.ts`), model server (`server/index.ts`), chat UI + director (`app/`). Decision 001, CONTRACTS.md filled.

## Missing / I need from someone
- Sarah's full design doc in docs/GAME_DESIGN.md: my copy was cut off after the investigation tools (MVP list, scoring and anything after are missing).
- A model endpoint (LLM_BASE_URL/KEY/MODEL); until then characters use scripted lines.

## Heads up for other agents
- `shared/types.ts` is the contract; change it only with a decision record.
- The engine is pure: no fetch, Date.now or Math.random in `game/engine.ts`. Async stuff lives in `app/director.ts` and `server/`.
