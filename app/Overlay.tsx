// The compact Liquid Glass layout shown inside Cue.app (desktop/). State and actions come from Session in App.tsx.
import { useEffect, useRef, useState } from 'react';
import { MODES, type Line, type Mode, type SavedRecap } from '../shared/cue.ts';
import { CheckBadge, RecapView, type Answer, type Status } from './App.tsx';
import { nativeSend } from './capture.ts';

interface Props {
  status: Status | null; sources: { you: boolean; them: boolean }; lines: Line[]; interim: { you: string; them: string }; answers: Answer[];
  recap: SavedRecap | 'loading' | null; notes: string[];
  toggleSource(who: Line['who']): void; ask(mode: Mode, q?: string): void; endAndRecap(): void;
}

export function Overlay({ status, sources, lines, interim, answers, recap, notes, toggleSource, ask, endAndRecap }: Props) {
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const ai = !!status?.ai;
  const live = sources.you || sources.them;
  const listening = sources.you && sources.them ? 'Hearing you + them' : sources.them ? 'Hearing them' : sources.you ? 'Hearing you' : ai ? 'Ready' : 'AI offline';

  useEffect(() => {
    (window as unknown as { __cueFocus: () => void }).__cueFocus = () => input.current?.focus(); // the shell calls this when ⌘\ shows the panel
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') nativeSend({ type: 'hide' }); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const recent = lines.slice(-2);
  return (
    <div className="ov">
      <div className="ov-handle" aria-hidden="true" />
      <header className="ov-top">
        <span className="ov-logo"><Icon d={SPARK} /> Cue</span>
        <span className={`ov-dot ${live ? 'live' : ''}`}>{listening}</span>
        <div className="ov-actions">
          <button className={`ov-pill ${sources.you ? 'on' : ''}`} onClick={() => toggleSource('you')} aria-pressed={sources.you} title={sources.you ? 'Stop captioning your mic' : 'Caption your mic'}><Icon d={sources.you ? MIC : MIC_OFF} />Me</button>
          <button className={`ov-pill ${sources.them ? 'on' : ''}`} onClick={() => toggleSource('them')} aria-pressed={sources.them} title={sources.them ? 'Stop captioning the call' : 'Caption the other people on the call'}><Icon d={sources.them ? SPEAKER : SPEAKER_OFF} />Them</button>
          <button className="ov-icon" onClick={endAndRecap} disabled={!lines.length || recap === 'loading' || !ai} aria-label="End and recap" title="End & recap"><Icon d={DOC} /></button>
          <button className="ov-icon" onClick={() => nativeSend({ type: 'hide' })} aria-label="Hide Cue" title="Hide (Esc)"><Icon d={CLOSE} /></button>
        </div>
      </header>

      <form className="ov-ask" onSubmit={e => { e.preventDefault(); if (q.trim()) { ask('ask', q.trim()); setQ(''); } }}>
        <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder={ai ? 'Ask about your screen or call…' : 'AI is offline'} aria-label="Ask Cue" disabled={!ai} maxLength={500} />
        <kbd title="What should I say?">⌘↵</kbd>
      </form>

      <nav className="ov-chips" aria-label="Quick actions">
        {(Object.keys(MODES) as (keyof typeof MODES)[]).map(m => <button key={m} disabled={!ai} onClick={() => ask(m)}>{MODES[m].label}</button>)}
      </nav>

      <main className="ov-body">
        {notes.map(n => <p key={n} className="ov-note">{n}</p>)}
        {recap === 'loading' && <p className="ov-empty">Writing your recap…</p>}
        {recap && recap !== 'loading' ? <RecapView saved={recap} storage={!!status?.storage} />
          : answers.length ? answers.map((a, i) => (
            <article key={a.id} className={`ov-answer ${i === 0 ? 'latest' : ''}`}>
              <h3>{a.label}</h3>
              {a.error ? <p className="error">{a.error}</p> : <p className="text">{a.text || <span className="ov-thinking">Thinking</span>}{!a.done && a.text && <span className="cursor" />}</p>}
              {a.check && <CheckBadge check={a.check} />}
            </article>
          ))
          : recap !== 'loading' && (
            <div className="ov-empty">
              <p>Ask anything. Cue sees the screen behind it.</p>
              <p className="ov-keys"><kbd>⌘\</kbd> show / hide · <kbd>⌘↵</kbd> what to say · <kbd>Esc</kbd> hide</p>
            </div>
          )}
      </main>

      <footer className="ov-captions" aria-live="polite">
        {recent.length || interim.you || interim.them
          ? <>{recent.map((l, i) => <p key={i} className={l.who}><b>{l.who === 'you' ? 'You' : 'Them'}</b>{l.text}</p>)}
              {interim.them && <p className="them interim"><b>Them</b>{interim.them}</p>}
              {interim.you && <p className="you interim"><b>You</b>{interim.you}</p>}</>
          : <p className="muted">{live ? 'Listening…' : 'Turn on Them to caption the call, and Me for your mic.'}</p>}
      </footer>
    </div>
  );
}

const Icon = ({ d }: { d: string }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const MIC = 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3';
const MIC_OFF = 'M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.9 5M19 11a7 7 0 0 1-.4 2.3M12 18v3';
const SPEAKER = 'M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13';
const SPEAKER_OFF = 'M11 5L6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6';
const DOC = 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6';
const CLOSE = 'M6 6l12 12M18 6L6 18';
const SPARK = 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z';
