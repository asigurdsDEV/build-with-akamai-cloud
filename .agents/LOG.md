# Activity log

Append only. One line per meaningful action. Newest at the bottom.
`YYYY-MM-DD HH:MM | agent@human | task | what you did`

2026-11-20 09:58 | claude@aiden | setup | created repo scaffolding and agent coordination files
2026-11-20 10:22 | claude@aiden | setup | claimed README, stack decision, contracts, playable skeleton
2026-11-20 10:16 | claude@ethan | setup | agent online
2026-11-20 10:11 | Jamihuh21 | setup | agent online
2026-11-20 10:26 | Jamihuh21 | setup | asked claude@aiden via handoff for one piece of the playable skeleton (server/ preferred)
2026-11-20 10:27 | srhyoun | setup | agent online
2026-11-20 10:28 | claude@ethan | rubric | posted judging rubric handoff to all, added two judging gaps + team-size question to BOARD Missing
2026-11-20 10:28 | Jamihuh21 | llm-endpoint | claimed server/ (LLM endpoint), split off claude@aiden's skeleton after Aiden agreed in person
2026-11-20 10:31 | claude@aiden | skeleton | playable Who's the Bot? skeleton: engine + tests, voice/prompts, model server, chat UI; decision 001, contracts, board tasks
2026-11-20 10:32 | claude@aiden | skeleton | split server/ off to Jamihuh21 (draft in 12d54d2), contract for POST /api/line in CONTRACTS.md, Akamai services in decision 001, board tasks for the two judging gaps
2026-11-20 16:10 | claude@aiden | pivot | repo is now Aiden + Caleb only, building Cue (live AI copilot); Who's the Bot? kept on branch aiden/game-skeleton for the team of four; claimed Cue v1
2026-11-20 16:14 | claude@aiden | cue | Cue v1: captions, screen context, streamed answers, quote check, pop-out, recaps in Object Storage; decision 001, contracts, board tasks
2026-11-20 16:33 | claude@aiden | cue-app | Cue.app: native Liquid Glass panel, ⌘\ hotkey, on-device captions, screen capture, bundled server, local Ollama gemma3:4b
2026-11-20 16:43 | claude@aiden | cue-app | Them captions from system audio, separate Me/Them toggles, quote check ignores suggested lines
2026-11-20 16:50 | claude@aiden | cue-app | opt-in Hide from Screen Sharing menu toggle (NSWindow.sharingType)
2026-11-20 16:53 | claude@aiden | cue-app | Settings page: about-you context, answer length, glass style, hide from sharing, open at login, clear session; model shown
2026-11-20 20:45 | claude@aiden | cue-app | SpeechAnalyzer captions (sentences land ~0.05 s after they end), Listen = both sources, auto-suggest replies on questions/turns, replies aimed at their latest turn
2026-11-20 21:31 | claude@aiden | cue-app | faster replies (no screenshot for replies, warm model, 0.3 s auto delay, 160-token cap) + reply prompt with rules/examples and a Say: line; pinned signing cert
2026-11-20 21:36 | claude@aiden | cue-app | model only loaded while panel open or listening (unload after 90 s hidden), Ollama stopped on quit, leftover cleanup after crashes
2026-11-20 22:02 | claude@aiden | cue-app | gemma3:12b (Smart, default) + 4B (Fast) switch; new question cancels the old reply end to end; replies focus on what's new since the last reply
