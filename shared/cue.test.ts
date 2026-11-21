import { describe, expect, it } from 'vitest';
import { askMessages, checkAnswer, parseRecap, recapChecks, transcriptText, type Line } from './cue.ts';

const lines: Line[] = [
  { who: 'them', text: 'Our budget is about forty thousand for Q1.', at: 0 },
  { who: 'you', text: "Great, we can ship the pilot by March.", at: 1000 },
];

describe('checkAnswer', () => {
  it('grounded when every quote was said (ignoring case and punctuation)', () => {
    const c = checkAnswer('They said "budget is about forty thousand" and you promised “ship the pilot by March”.', lines);
    expect(c.status).toBe('grounded');
    expect(c.quotes).toHaveLength(2);
  });
  it('unverified when a quote was never said', () => {
    const c = checkAnswer('They said "budget is fifty thousand".', lines);
    expect(c.status).toBe('unverified');
    expect(c.quotes[0].found).toBe(false);
  });
  it('an unclosed curly quote does not swallow the next quote', () => {
    const c = checkAnswer('“Sounds good, let’s go. “ship the pilot by March.”', lines);
    expect(c.status).toBe('grounded');
  });
  it('suggested lines (quotes that start a line or bullet) are not checked; inline claims are', () => {
    const c = checkAnswer('“Totally fair, let me see what I can do.”\n* “We could split it into two payments.”\nThey said “budget is fifty thousand”.', lines);
    expect(c.quotes.map(q => q.text)).toEqual(['budget is fifty thousand']);
    expect(c.status).toBe('unverified');
    expect(checkAnswer('“Totally fair, let me see what I can do.”', lines).status).toBe('general');
  });
  it('general when there are no quotes', () => {
    expect(checkAnswer('A pilot usually takes 6 weeks.', lines).status).toBe('general');
  });
});

describe('prompts', () => {
  it('labels speakers and only attaches the screen for vision models', () => {
    expect(transcriptText(lines)).toBe('Them: Our budget is about forty thousand for Q1.\nMe: Great, we can ship the pilot by March.');
    const img = 'data:image/jpeg;base64,xx';
    expect(typeof askMessages({ mode: 'say', lines, image: img }, false)[1].content).toBe('string');
    expect(JSON.stringify(askMessages({ mode: 'say', lines, image: img }, true)[1].content)).toContain(img);
  });
  it('adds the user profile and answer length to the system prompt', () => {
    const sys = askMessages({ mode: 'say', lines, profile: 'I sell solar panels', length: 'detailed' }, false)[0].content as string;
    expect(sys).toContain('I sell solar panels');
    expect(sys).toContain('up to 200 words');
    expect(askMessages({ mode: 'say', lines }, false)[0].content).toContain('under 80 words');
  });
  it('caps a custom question', () => {
    const m = askMessages({ mode: 'ask', question: 'x'.repeat(2000), lines }, false);
    expect((m[1].content as string).length).toBeLessThan(1000);
  });
});

describe('recap', () => {
  it('parses fenced JSON and checks action quotes', () => {
    const r = parseRecap('```json\n{"title":"Q1 pilot","summary":"s","actions":[{"text":"Ship pilot","quote":"ship the pilot by March"},{"text":"Hire","quote":"we will hire two people"}]}\n```');
    expect(r.title).toBe('Q1 pilot');
    expect(recapChecks(r, lines).map(c => c.status)).toEqual(['grounded', 'unverified']);
  });
});
