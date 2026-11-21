import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MODES, checkAnswer, type Check, type Line, type Mode, type SavedRecap } from '../shared/cue.ts';
import { canCaptionMic, captionMic, grabFrame, native, nativeCaptions, nativeFrame, onNativeEvents, recordTabAudio, shareScreen } from './capture.ts';
import { Overlay } from './Overlay.tsx';

export interface Prefs { profile: string; length: 'short' | 'detailed' }
const loadPrefs = (): Prefs => { try { return { profile: '', length: 'short', ...JSON.parse(localStorage.getItem('cue.prefs') ?? '{}') }; } catch { return { profile: '', length: 'short' }; } };
export interface Status { model?: string; ai: boolean; vision: boolean; stt: boolean; storage: boolean }
export interface Answer { id: number; label: string; text: string; done: boolean; check?: Check; error?: string }
type PipWindow = Window & typeof globalThis;
const pipApi = (window as unknown as { documentPictureInPicture?: { requestWindow(o: { width: number; height: number }): Promise<PipWindow> } }).documentPictureInPicture;

export function App() {
  const recapId = location.pathname.match(/^\/r\/([0-9a-f-]{36})$/)?.[1];
  return recapId ? <RecapPage id={recapId} /> : <Session />;
}

function Session() {
  const [status, setStatus] = useState<Status | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [interim, setInterim] = useState({ you: '', them: '' });
  const [live, setLive] = useState(false);
  const [sources, setSources] = useState({ you: false, them: false }); // Cue.app: which caption streams are on
  const sourceStops = useRef<Partial<Record<Line['who'], () => void>>>({});
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [recap, setRecap] = useState<SavedRecap | 'loading' | null>(null);
  const [pip, setPip] = useState<PipWindow | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const setPrefs = (p: Partial<Prefs>) => setPrefsState(old => { const next = { ...old, ...p }; try { localStorage.setItem('cue.prefs', JSON.stringify(next)); } catch { /* private mode: keep in memory */ } return next; });
  const linesRef = useRef(lines); linesRef.current = lines;
  const stops = useRef<(() => void)[]>([]);
  const t0 = useRef(0);

  useEffect(() => { fetch('/api/status').then(r => r.json()).then(setStatus).catch(() => setStatus({ ai: false, vision: false, stt: false, storage: false })); }, []);
  const addLine = (who: Line['who'], text: string) => text && setLines(ls => [...ls, { who, text, at: Math.round(performance.now() - t0.current) }]);
  const note = (msg: string) => setNotes(n => n.includes(msg) ? n : [...n, msg]);
  const sourceOff = (who: Line['who']) => { delete sourceStops.current[who]; setSources(s => ({ ...s, [who]: false })); setInterim(i => ({ ...i, [who]: '' })); };
  useEffect(() => { if (native) onNativeEvents(note, sourceOff); }, []);
  useEffect(() => { if (native) setLive(sources.you || sources.them); }, [sources]);

  // Cue.app: turn captions of your mic ("you") or of the call audio ("them") on or off, independently.
  function toggleSource(who: Line['who']) {
    if (sources[who]) { sourceStops.current[who]?.(); sourceOff(who); return; }
    if (!sources.you && !sources.them && recap) { setLines([]); setAnswers([]); setRecap(null); } // a new session after a recap
    if (!t0.current) t0.current = performance.now();
    setNotes([]);
    sourceStops.current[who] = nativeCaptions(who, (final, partial) => { addLine(who, final); setInterim(i => ({ ...i, [who]: partial })); });
    setSources(s => ({ ...s, [who]: true }));
  }

  async function start() {
    setLines([]); setAnswers([]); setRecap(null); setNotes([]); t0.current = performance.now(); setLive(true);
    const onText = (final: string, partial: string) => { addLine('you', final); setInterim(i => ({ ...i, you: partial })); };
    stops.current.push(captionMic(onText, note));
    try {
      const s = await shareScreen();
      setScreen(s);
      s.getVideoTracks()[0]?.addEventListener('ended', () => setScreen(null));
      stops.current.push(() => s.getTracks().forEach(t => t.stop()));
      if (!s.getAudioTracks().length) note('No tab audio shared: only your mic is captioned. Share a tab with "Share tab audio" on to caption the other side.');
      else if (!status?.stt) note('Tab audio is shared, but no speech model is set (STT_MODEL), so the other side is not captioned.');
      else {
        const stop = recordTabAudio(s, async blob => {
          const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'content-type': blob.type }, body: blob }).catch(() => null);
          if (r?.ok) addLine('them', (await r.json()).text);
        });
        if (stop) stops.current.push(stop);
      }
    } catch { note('Screen not shared: answers use the conversation only.'); }
  }

  function stop() { stops.current.forEach(f => f()); stops.current = []; (['you', 'them'] as const).forEach(w => { sourceStops.current[w]?.(); sourceOff(w); }); setLive(false); setScreen(null); setInterim({ you: '', them: '' }); }

  async function ask(mode: Mode, question?: string) {
    const id = Date.now();
    const label = mode === 'ask' ? question! : MODES[mode].label;
    const update = (patch: Partial<Answer>) => setAnswers(a => a.map(x => x.id === id ? { ...x, ...patch } : x));
    setAnswers(a => [{ id, label, text: '', done: false }, ...a]);
    try {
      const image = !status?.vision ? undefined : native ? await nativeFrame() : screen ? await grabFrame(screen) : undefined;
      const res = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, question, lines: linesRef.current, image, ...prefsRef.current }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `error ${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let text = '';
      for (let r = await reader.read(); !r.done; r = await reader.read()) update({ text: (text += r.value) });
      update({ done: true, check: checkAnswer(text, linesRef.current) });
    } catch (e) { update({ done: true, error: (e as Error).message }); }
  }

  async function endAndRecap() {
    stop(); setRecap('loading');
    try {
      const r = await fetch('/api/recap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines: linesRef.current }) });
      if (!r.ok) throw new Error((await r.json()).error);
      setRecap(await r.json());
    } catch (e) { setRecap(null); note(`Recap failed: ${(e as Error).message}`); }
  }

  async function popOut() {
    if (!pipApi) return note('Pop-out needs Chrome or Edge.');
    const w = await pipApi.requestWindow({ width: 400, height: 560 });
    document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(n => w.document.head.append(n.cloneNode(true)));
    w.document.title = 'Cue';
    w.addEventListener('pagehide', () => setPip(null));
    setPip(w);
  }

  // Ctrl/Cmd + Enter anywhere (main window or pop-out) = "What should I say?"
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && status?.ai) { e.preventDefault(); ask('say'); } };
    const targets = [window, pip].filter(Boolean) as Window[];
    targets.forEach(t => t.addEventListener('keydown', onKey));
    return () => targets.forEach(t => t.removeEventListener('keydown', onKey));
  });

  const clearSession = () => { stop(); setLines([]); setAnswers([]); setRecap(null); setNotes([]); t0.current = 0; };
  if (native) return <Overlay {...{ status, sources, lines, interim, answers, recap, notes, toggleSource, ask, endAndRecap, prefs, setPrefs, clearSession }} />;
  const panel = <AskPanel answers={answers} disabled={!status?.ai} onAsk={ask} />;

  return (
    <div className="app">
      <header>
        <h1>Cue</h1>
        <div className="chips">
          <Chip on={live && canCaptionMic}>Mic</Chip>
          <Chip on={!!screen}>Screen</Chip>
          <Chip on={!!status?.ai}>AI</Chip>
        </div>
        <div className="actions">
          {!live ? <button className="primary" onClick={start}>Start session</button> : <button onClick={stop}>Pause</button>}
          {pipApi && !pip && <button onClick={popOut} title="Keep answers on top of other windows">Pop out</button>}
          <button onClick={endAndRecap} disabled={!lines.length || recap === 'loading' || !status?.ai}>{recap === 'loading' ? 'Writing recap…' : 'End & recap'}</button>
        </div>
      </header>

      {status && !status.ai && <p className="note">AI isn't connected yet (set <code>AI_BASE_URL</code> on the server). Captions still work.</p>}
      {notes.map(n => <p key={n} className="note">{n}</p>)}

      {recap && recap !== 'loading'
        ? <RecapView saved={recap} storage={!!status?.storage} />
        : (
          <main className="grid">
            <Transcript lines={lines} interim={interim.you} live={live} onStart={start} />
            {pip ? <section className="panel muted">Answers are in the pop-out window. <button onClick={() => pip.close()}>Bring back</button></section> : panel}
          </main>
        )}
      {pip && createPortal(<div className="app pip">{panel}</div>, pip.document.body)}
    </div>
  );
}

function Transcript({ lines, interim, live, onStart }: { lines: Line[]; interim: string; live: boolean; onStart: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [lines.length, interim]);
  if (!live && !lines.length) return (
    <section className="panel empty">
      <h2>Your live copilot for calls</h2>
      <ol>
        <li>Start a session and allow the mic. Share the tab with your call (tick "Share tab audio") to caption both sides.</li>
        <li>Ask anytime: <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> suggests what to say next. Cue sees the screen you shared.</li>
        <li>Every answer is checked: quotes must match what was really said.</li>
        <li>End & recap: a summary with action items and a link to share.</li>
      </ol>
      <button className="primary" onClick={onStart}>Start session</button>
    </section>
  );
  return (
    <section className="panel transcript" aria-label="Live transcript" aria-live="polite">
      {lines.map((l, i) => <p key={i} className={l.who}><b>{l.who === 'you' ? 'You' : 'Them'}</b> {l.text}</p>)}
      {interim && <p className="you interim"><b>You</b> {interim}</p>}
      {live && !lines.length && !interim && <p className="muted">Listening…</p>}
      <div ref={end} />
    </section>
  );
}

function AskPanel({ answers, disabled, onAsk }: { answers: Answer[]; disabled: boolean; onAsk: (m: Mode, q?: string) => void }) {
  const [q, setQ] = useState('');
  return (
    <section className="panel ask" aria-label="Ask Cue">
      <div className="quick">
        {(Object.keys(MODES) as (keyof typeof MODES)[]).map(m => <button key={m} disabled={disabled} onClick={() => onAsk(m)}>{MODES[m].label}</button>)}
      </div>
      <form onSubmit={e => { e.preventDefault(); if (q.trim()) { onAsk('ask', q.trim()); setQ(''); } }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ask anything about this call…" aria-label="Ask Cue" disabled={disabled} maxLength={500} />
        <button className="primary" disabled={disabled}>Ask</button>
      </form>
      <div className="answers">
        {answers.map(a => (
          <article key={a.id} className="answer">
            <h3>{a.label}</h3>
            {a.error ? <p className="error">{a.error}</p> : <p className="text">{a.text || '…'}{!a.done && <span className="cursor" />}</p>}
            {a.check && <CheckBadge check={a.check} />}
          </article>
        ))}
      </div>
    </section>
  );
}

export function CheckBadge({ check }: { check: Check }) {
  const icon = { grounded: '✓', unverified: '⚠', general: '○' }[check.status];
  return (
    <details className={`check ${check.status}`}>
      <summary>{icon} {check.note}</summary>
      {check.quotes.map((q, i) => <p key={i}>{q.found ? '✓' : '✗'} "{q.text}"</p>)}
    </details>
  );
}

export function RecapView({ saved, storage }: { saved: SavedRecap; storage: boolean }) {
  const link = saved.id ? `${location.origin}/r/${saved.id}` : '';
  const [copied, setCopied] = useState(false);
  return (
    <main className="recap panel">
      <h2>{saved.recap.title}</h2>
      <p className="muted">{new Date(saved.createdAt).toLocaleString()}</p>
      {link
        ? <p className="share">Saved to Akamai Object Storage. <a href={link}>{link}</a> <button onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy link'}</button></p>
        : !storage && <p className="note">Not saved: Object Storage isn't configured on the server.</p>}
      <p>{saved.recap.summary}</p>
      {saved.recap.actions.length > 0 && <>
        <h3>Action items</h3>
        <ul className="actions-list">
          {saved.recap.actions.map((a, i) => <li key={i}>{a.text}{saved.checks[i] && <CheckBadge check={saved.checks[i]} />}</li>)}
        </ul>
      </>}
      <details><summary>Full transcript ({saved.lines.length} lines)</summary>
        <div className="transcript">{saved.lines.map((l, i) => <p key={i} className={l.who}><b>{l.who === 'you' ? 'You' : 'Them'}</b> {l.text}</p>)}</div>
      </details>
      {!location.pathname.startsWith('/r/') && <button className="primary" onClick={() => location.reload()}>New session</button>}
    </main>
  );
}

function RecapPage({ id }: { id: string }) {
  const [saved, setSaved] = useState<SavedRecap | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { fetch(`/api/recap/${id}`).then(async r => r.ok ? setSaved(await r.json()) : setError((await r.json()).error)).catch(e => setError(String(e))); }, [id]);
  return <div className="app"><header><h1><a href="/">Cue</a></h1></header>{saved ? <RecapView saved={saved} storage /> : <p className="note">{error || 'Loading recap…'}</p>}</div>;
}

const Chip = ({ on, children }: { on: boolean; children: ReactNode }) => <span className={`chip ${on ? 'on' : ''}`}>{children}</span>;
