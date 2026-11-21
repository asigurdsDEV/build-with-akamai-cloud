// Shared by app and server: types, prompts and the output check. Pure, no I/O.

export interface Line { who: 'you' | 'them'; text: string; at: number } // at = ms since session start
export type Mode = 'say' | 'screen' | 'summary' | 'followups' | 'ask';
export interface AskRequest { mode: Mode; question?: string; lines: Line[]; image?: string; profile?: string; length?: 'short' | 'detailed'; focus?: string; model?: string } // focus = what they said since Cue's last reply // image = JPEG data URL of the screen; profile = what the user told Cue about themselves
export interface Quote { text: string; found: boolean }
export interface Check { status: 'grounded' | 'unverified' | 'general'; quotes: Quote[]; note: string }
export interface Recap { summary: string; actions: { text: string; quote?: string }[]; title: string }
export interface SavedRecap { id: string; createdAt: string; recap: Recap; checks: Check[]; lines: Line[] }

export const MODES: Record<Exclude<Mode, 'ask'>, { label: string; prompt: string }> = {
  say: { label: 'What should I say?', prompt: 'Write what I should say next in this conversation.' },
  screen: { label: 'Explain my screen', prompt: "Explain what's on my screen right now and what matters about it for this conversation." },
  summary: { label: 'Summarize so far', prompt: 'Summarize the conversation so far in at most 4 bullets, then any open questions.' },
  followups: { label: 'Follow-up questions', prompt: 'Give me 3 sharp follow-up questions I could ask next.' },
};

// Consecutive lines from the same speaker joined into one turn, so the model reads whole thoughts, not fragments.
export function turns(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (const l of lines) {
    const last = out.at(-1);
    if (last && last.who === l.who) last.text += ' ' + l.text; else out.push({ ...l });
  }
  return out;
}

// How Cue writes a reply for the user to say. The example keeps small local models on format and on facts.
const REPLY_RULES = `How to write the reply:
- At most 2 sentences and 35 words. The first sentence answers exactly what they asked or raised, concretely.
- Only use facts from "About the user" and the call. Never invent numbers, dates, features, guarantees or promises. Never say "definitely" or "guarantee". If you lack a fact, offer to confirm it or suggest a concrete next step.
- "About the user" describes ME, the person talking. "Them" are the other people.
- If they raised a worry, name it in a few words, then deal with it using a real fact.
- Plain spoken words, contractions. No filler like "Absolutely", "Great question", "I understand", "That's good to hear".
- End with a short question or next step when it helps.
Format, exactly:
Say: <the reply, no quote marks>
- <a real fact that backs it up>
- <another real fact, or leave this line out>

Example 1. About the user: we build Shopify stores for local shops, usually 4-6 weeks, from $8k.
They said: How long would a store like ours take?
Say: For a shop your size it's usually four to six weeks. Want to do a quick kickoff call this week to pin down the plan?
- Typical build: 4-6 weeks

Example 2. Same user. They said: Our last agency vanished after launch.
Say: That's a fair worry. We include 30 days of support after launch, so you're not on your own. Should I send you what that covers?
- 30 days of post-launch support included`;

export const transcriptText = (lines: Line[], max = 6000) =>
  turns(lines).map(l => `${l.who === 'you' ? 'Me' : 'Them'}: ${l.text}`).join('\n').slice(-max); // shortcut: keeps only the latest ~6k chars; summarize older parts if calls run long

/** What the other side said since the user last spoke. */
export const lastTheirTurn = (lines: Line[]) => { const t = turns(lines).at(-1); return t?.who === 'them' ? t.text : ''; };

/** Did they just ask something? Used to auto-suggest a reply as soon as they finish. */
export const isQuestion = (text: string) =>
  /\?\s*$/.test(text.trim()) || /^(can|could|would|will|do|does|did|is|are|was|were|have|has|should|what|why|how|when|where|who|which|tell me|walk me|any thoughts)\b/i.test(text.trim().split(/(?<=[.!?])\s+/).at(-1) ?? '');

export function askMessages(r: AskRequest, vision: boolean) {
  const transcript = transcriptText(r.lines) || '(nothing said yet)';
  const theirs = lastTheirTurn(r.lines);
  const task = r.mode === 'ask' ? (r.question ?? '').slice(0, 500)
    : r.mode === 'say' && theirs ? `They just said: ${theirs.slice(-600)}\n${r.focus && r.focus.trim() !== theirs.trim() ? `Their newest point, which the reply must answer (earlier parts were already answered): ${r.focus.slice(-400)}\n` : ''}Write what I should say back.`
    : MODES[r.mode].prompt;
  const text = `Transcript so far:\n${transcript}\n\nTask: ${task}`;
  const profile = r.profile?.trim().slice(0, 1000);
  const brevity = r.mode === 'say' ? `${REPLY_RULES}${r.length === 'detailed' ? '\nYou may use up to 3 sentences and 3 backup points.' : ''}`
    : r.length === 'detailed' ? 'Be thorough but organized: up to 200 words, short bullets welcome, no preamble.' : 'Be fast and brief: lead with the answer, under 80 words, plain text or short bullets, no preamble.';
  return [
    { role: 'system', content: `You are Cue, a live assistant during the user's call or work session. "Me" is the user, "Them" is everyone else.
${brevity}${profile ? `\nAbout the user (use it to tailor answers, never quote it as something said): ${profile}` : ''}
When you rely on something said in the transcript, quote the exact words in "double quotes". Use double quotes for nothing else: write suggested lines without quote marks.
If the answer isn't in the transcript or on the screen, say it's general knowledge. Never invent what someone said.` },
    { role: 'user', content: vision && r.image ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: r.image } }] : text },
  ];
}

export function recapMessages(lines: Line[]) {
  return [
    { role: 'system', content: `You write meeting recaps. Answer with JSON only:
{"title": "max 6 words", "summary": "3-5 sentences", "actions": [{"text": "action item, who does what", "quote": "exact words from the transcript that support it"}]}
Only include action items that someone actually said. Copy quotes exactly.` },
    { role: 'user', content: transcriptText(lines, 20000) || '(empty)' },
  ];
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// The visible output check: every quote the model claims was said must really be in the transcript.
// A quote that starts its own line or bullet is a suggested line to say, not a claim, so it isn't checked
// (small models quote their suggestions even when told not to). Recap quotes are always checked.
export function checkAnswer(answer: string, lines: Line[], skipSuggestions = true): Check {
  const said = norm(lines.map(l => l.text).join(' '));
  const isSuggestion = (at: number) => skipSuggestions && /^[\s*•\-–\d.)]*$/.test(answer.slice(answer.lastIndexOf('\n', at - 1) + 1, at));
  const quotes = [...answer.matchAll(/["“]([^"“”]{4,200})["”]/g)].filter(m => !isSuggestion(m.index!)).map(m => ({ text: m[1], found: said.includes(norm(m[1])) }));
  if (!quotes.length) return { status: 'general', quotes, note: 'Nothing quoted from the call: general knowledge, the screen, or suggested lines.' };
  const missing = quotes.filter(q => !q.found).length;
  const n = quotes.length, of = n === 1 ? 'The quote' : `${missing} of ${n} quotes`;
  return missing
    ? { status: 'unverified', quotes, note: `${of} ${missing === 1 && n > 1 ? 'was' : n === 1 ? 'was' : 'were'} never said. Double-check this answer.` }
    : { status: 'grounded', quotes, note: n === 1 ? 'The quote matches the transcript.' : `All ${n} quotes match the transcript.` };
}

// Model answers for the recap should be JSON; tolerate code fences and stray text around it.
export function parseRecap(raw: string): Recap {
  const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  return {
    title: String(j.title ?? 'Session recap').slice(0, 80),
    summary: String(j.summary ?? ''),
    actions: Array.isArray(j.actions) ? j.actions.map((a: { text?: unknown; quote?: unknown }) => ({ text: String(a.text ?? ''), quote: a.quote ? String(a.quote) : undefined })).filter((a: { text: string }) => a.text) : [],
  };
}

export const recapChecks = (r: Recap, lines: Line[]) => r.actions.map(a => checkAnswer(a.quote ? `"${a.quote}"` : '', lines, false));
