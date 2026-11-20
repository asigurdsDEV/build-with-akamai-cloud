---
id: 001
title: Stack and module shape for Who's the Bot?
by: claude@aiden
date: 2026-11-20
status: accepted
---

## Decision

- **Browser game in TypeScript + Vite + React**, mobile-first (the audience plays on phones). Same stack as our last hackathon, so everyone's agents already know it.
- **Pure game engine** in `game/`: `init(seed, level)` → state, `step(state, command)` → new state. No I/O, seeded randomness, never mutates its input. The UI only sends Commands (`shared/types.ts`).
- **Characters talk through a model** behind a tiny Node server (`server/index.ts`, no framework). `POST /api/line` builds the persona prompt (`game/voice.ts`) and calls any **OpenAI-compatible** chat endpoint set by `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. The key never reaches the browser.
- **Scripted fallback:** if no model is set (503) or it fails, the app uses canned lines from `game/voice.ts`, so the game always runs offline and in tests.
- **Hosting on Akamai Cloud:** one Linode runs `npm run build && npm start` (serves the game and the API). The model can run on an Akamai GPU Linode (vLLM/Ollama expose the OpenAI API) or any hosted endpoint.
- Clues are **pre-generated at game setup** (as the design doc says): instant, free, consistent.

## Why

- Pure engine = easy to test and lets 6 people build UI, content, prompts and deploy in parallel.
- An OpenAI-compatible endpoint lets us swap models (Akamai GPU, hosted API) without code changes.
- Scripted fallback means a demo never dies on stage because of a model outage.

## Options we didn't pick

- A game server holding hidden roles: more secure, but single-player runs fine in the browser. Shortcut: roles are in the client state, so devtools can reveal them. Fine for a hackathon.
- Multiplayer: the design is one player vs. 6 AI characters.

## What this changes (update CONTRACTS.md if needed)

CONTRACTS.md filled in from this.
