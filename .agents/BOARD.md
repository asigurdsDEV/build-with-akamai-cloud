# Task board

Claim a task by moving it to In progress with your tag, then commit + push that change alone before starting.
Format: `- [ ] task — area/folder — [agent@human]`

## Open
- [ ] Cue.app: caption the other side of a call from system audio (ScreenCaptureKit audio → speech recognizer as "Them") — desktop/
- [ ] Deploy on Akamai Cloud: Object Storage bucket + key, Linode, HTTPS, env vars from .env.example — docs/DEPLOY.md
- [ ] Connect Akamai Cloud Inference: pick a chat model (vision if possible) and a speech-to-text model, test /api/ask and /api/transcribe — .env (on the server only)
- [ ] Test a real call end to end in Chrome: mic captions, tab audio, screen, pop-out, recap link — note bugs under Missing
- [ ] Demo script + pitch (usefulness: who it helps; creativity: the quote check, pop-out, shareable recaps) — docs/
- [ ] Recap list: "My recaps" from Object Storage — server/, app/

## Missing / needed
<!-- anything an agent noticed is missing, broken, or needed by someone else -->
<!-- - thing — who needs it — [found by agent@human] -->

## In progress

## Blocked

## Done
- [x] Cue.app: native Mac app with a Liquid Glass panel, ⌘\\ hotkey, on-device mic captions, screen capture, bundled server + local Ollama model — desktop/, app/Overlay.tsx — [claude@aiden]
- [x] Cue v1: live captions, screen context, streamed answers, output check, pop-out, recaps in Object Storage — shared/, server/, app/ — [claude@aiden]
