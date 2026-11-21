# Build with Akamai Cloud — Team Repo

Setup only. No project code yet.

Open source under the MIT License.

## What's here

This repo is set up so every teammate's AI agent (Claude Code, Codex, Copilot, Gemini, whatever you use) can coordinate with the others through files in the repo, instead of stepping on each other.

```
AGENTS.md            rules every AI agent reads first (CLAUDE.md points here)
.agents/
  status/            one file per teammate: what their agent is doing, touching, missing
  BOARD.md           shared task board — claim tasks here before working
  LOG.md             append-only activity log, one line per meaningful action
  CONTRACTS.md       interfaces between parts of the project (fill in on day 1)
  handoffs/          notes one agent leaves for the next
  decisions/         short records of design decisions
docs/                challenge brief, research, pitch notes
.github/             PR + issue templates
```

## How it works (humans)

0. First thing at 9: fill in your `.agents/status/<yourname>.md` and your row in the team table.
1. Pull before you prompt your agent. Push when it's done a chunk.
2. Point your agent at `AGENTS.md` (Claude Code reads `CLAUDE.md` automatically, which links there).
3. Each person works on their own branch: `<name>/<task>` e.g. `aiden/physics-core`.
4. Merge to `main` through PRs so the other agents see clean history.

## Team

| Name | Role | Agent |
|------|------|-------|
| Aiden | | Claude Code |
| Caleb | | |

## Challenge

Build with Akamai Cloud. Judging criteria: `docs/JUDGING.md`.

## Cue: a live AI copilot for calls

Open Cue in the browser next to your call. It captions the conversation live, sees the screen you share, and answers in a second: what to say next, what's on screen, a summary, follow-up questions, or anything you type. Every answer is checked, so any quote has to match what was really said. When you're done, Cue writes a recap with action items and saves it to Akamai Object Storage with a link you can share.

- **Who it's for:** anyone in calls who needs answers fast (sales, support, interviews as the interviewer, students in lectures), and people who are deaf or hard of hearing, who get live captions of both sides.
- **Akamai Cloud:** Cloud Inference (answers, recaps, speech-to-text), Object Storage (saved, shareable recaps), Compute (hosting). Details: `.agents/decisions/001-cue.md`.
- **Output check:** `checkAnswer()` in `shared/cue.ts`. ✓ all quotes match the transcript, ⚠ a quote was never said, ○ no quotes (general knowledge).
- **Keyboard:** `Ctrl`/`⌘` + `Enter` = "What should I say?". **Pop out** keeps answers on top of other windows (Chrome/Edge).

### Run it

Needs Node 23.6+ and Chrome or Edge.

```
npm install
npm test
npm run build
AI_BASE_URL=... AI_API_KEY=... AI_MODEL=... npm start   # http://localhost:8787
```

All settings are in `.env.example`. Without `AI_BASE_URL` the captions still work but nothing answers; without the `S3_*` settings recaps aren't saved. For UI work, run `npm run dev` (port 5173) next to `npm start`.

### Mac app (Cue.app)

A menu-bar app with a floating **Liquid Glass** panel (macOS 26+). **⌘\\** shows or hides it from anywhere, **⌘↵** asks "What should I say?", **Esc** hides it. It captions your mic with Apple's on-device speech recognition and screenshots whatever is behind the panel when you ask (it leaves itself out). It starts its own server and, by default, a local model through Ollama. It opens at login (turn that off with "Open at Login" in the ✨ menu).

```
brew install ollama && ollama pull gemma3:4b   # once
./desktop/build.sh                              # builds ~/Applications/Cue.app and opens it
```

The first time, macOS asks for Microphone, Speech Recognition and Screen Recording. To use Akamai Cloud Inference or Object Storage instead, put the `.env.example` settings in `~/Library/Application Support/Cue/cue.env`. Logs: `~/Library/Logs/Cue.log`. To preview the panel layout in a browser, open `http://localhost:8787/?overlay`.

### Deploy on Akamai Cloud

1. Create an Object Storage bucket (private) and an access key.
2. Create a Linode, install Node 23.6+, clone the repo, `npm ci && npm run build`.
3. Set the env vars from `.env.example` and run `npm start` (e.g. as a systemd service).
4. Put HTTPS in front (e.g. Caddy: `your-domain { reverse_proxy localhost:8787 }`). The mic and screen share only work over HTTPS.

```
shared/cue.ts     types, prompts, the output check (pure, tested)
server/index.ts   API + static files; Akamai Cloud Inference and Object Storage
app/capture.ts    mic captions, screen share, screen frames, tab-audio chunks
app/App.tsx       the UI: session, answers, pop-out, recap page
app/Overlay.tsx   the compact glass layout used inside Cue.app
desktop/          Cue.app: native Swift shell (Liquid Glass panel, ⌘\\ hotkey, captions, screen capture)
```
