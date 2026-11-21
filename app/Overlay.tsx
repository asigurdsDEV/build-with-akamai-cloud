// The compact Liquid Glass layout shown inside Cue.app (desktop/). State and actions come from Session in App.tsx.
import { useEffect, useRef, useState } from 'react';
import { MODES, type Line, type Mode, type SavedRecap } from '../shared/cue.ts';
import { CheckBadge, RecapView, type Answer, type Prefs, type Status } from './App.tsx';
import { nativeSend, onNativeSettings, type NativeSettings } from './capture.ts';

interface Props {
  status: Status | null; sources: { you: boolean; them: boolean }; lines: Line[]; interim: { you: string; them: string }; answers: Answer[];
  recap: SavedRecap | 'loading' | null; notes: string[];
  toggleSource(who: Line['who']): void; toggleListen(): void; ask(mode: Mode, q?: string): void; endAndRecap(): void;
  prefs: Prefs; setPrefs(p: Partial<Prefs>): void; clearSession(): void;
}

export function Overlay({ status, sources, lines, interim, answers, recap, notes, toggleSource, toggleListen, ask, endAndRecap, prefs, setPrefs, clearSession }: Props) {
  const [q, setQ] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(settingsOpen); settingsRef.current = settingsOpen;
  const input = useRef<HTMLInputElement>(null);
  const ai = !!status?.ai;
  const live = sources.you || sources.them;

  useEffect(() => {
    (window as unknown as { __cueFocus: () => void }).__cueFocus = () => input.current?.focus(); // the shell calls this when ⌘\ shows the panel
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') settingsRef.current ? setSettingsOpen(false) : nativeSend({ type: 'hide' }); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const recent = lines.slice(-2);
  return (
    <div className="ov">
      <div className="ov-handle" aria-hidden="true" />
      <header className="ov-top">
        <span className="ov-logo"><Icon d={SPARK} /> Cue</span>
        <div className="ov-actions">
          <button className={`ov-pill ov-listen ${live ? 'on' : ''}`} onClick={toggleListen} aria-pressed={live} title={live ? 'Stop listening' : 'Caption you and the call'}><Icon d={WAVE} />{live ? 'Listening' : 'Listen'}</button>
          <button className="ov-icon" onClick={endAndRecap} disabled={!lines.length || recap === 'loading' || !ai} aria-label="End and recap" title="End & recap"><Icon d={DOC} /></button>
          <button className={`ov-icon ${settingsOpen ? 'active' : ''}`} onClick={() => setSettingsOpen(o => !o)} aria-label="Settings" aria-pressed={settingsOpen} title="Settings"><Icon d={GEAR} /></button>
          <button className="ov-icon" onClick={() => nativeSend({ type: 'hide' })} aria-label="Hide Cue" title="Hide (Esc)"><Icon d={CLOSE} /></button>
        </div>
      </header>

      {settingsOpen ? <Settings status={status} prefs={prefs} setPrefs={setPrefs} clearSession={() => { clearSession(); setSettingsOpen(false); }} /> : <>
      <form className="ov-ask" onSubmit={e => { e.preventDefault(); if (q.trim()) { ask('ask', q.trim()); setQ(''); } }}>
        <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder={ai ? 'Ask about your screen or call…' : 'AI is offline'} aria-label="Ask Cue" disabled={!ai} maxLength={500} />
        <kbd title="What should I say?">⌘↵</kbd>
      </form>

      <nav className="ov-chips" aria-label="Quick actions">
        {(Object.keys(MODES) as (keyof typeof MODES)[]).map(m => <button key={m} disabled={!ai} onClick={() => ask(m)}>{MODES[m].label}</button>)}
      </nav>

      <main className="ov-body">
        {status && !ai && <p className="ov-note">AI is offline. Choose Reload from the ✨ menu, or check ~/Library/Logs/Cue.log.</p>}
        {notes.map(n => <p key={n} className="ov-note">{n}</p>)}
        {recap === 'loading' && <p className="ov-empty">Writing your recap…</p>}
        {recap && recap !== 'loading' ? <RecapView saved={recap} storage={!!status?.storage} />
          : answers.length ? answers.map((a, i) => (
            <article key={a.id} className={`ov-answer ${i === 0 ? 'latest' : ''} ${a.auto ? 'auto' : ''}`}>
              <h3>{a.label}</h3>
              {a.error ? <p className="error">{a.error}</p> : <AnswerText text={a.text} done={a.done} />}
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

      {live && (
        <div className="ov-sources" aria-label="Caption sources">
          <button className={sources.them ? 'on' : ''} onClick={() => toggleSource('them')} aria-pressed={sources.them} title="The other people on the call (your Mac's audio)"><Icon d={sources.them ? SPEAKER : SPEAKER_OFF} />Them</button>
          <button className={sources.you ? 'on' : ''} onClick={() => toggleSource('you')} aria-pressed={sources.you} title="Your mic. Turn off to only follow what they say."><Icon d={sources.you ? MIC : MIC_OFF} />Me</button>
          {prefs.auto && <span className="ov-auto">Auto-reply on</span>}
        </div>
      )}
      <footer className="ov-captions" aria-live="polite">
        {recent.length || interim.you || interim.them
          ? <>{recent.map((l, i) => <p key={i} className={l.who}><b>{l.who === 'you' ? 'You' : 'Them'}</b>{l.text}</p>)}
              {interim.them && <p className="them interim"><b>Them</b>{interim.them}</p>}
              {interim.you && <p className="you interim"><b>You</b>{interim.you}</p>}</>
          : <p className="muted">{live ? 'Listening…' : 'Tap Listen to caption you and the call.'}</p>}
      </footer>
      </>}
    </div>
  );
}

function Settings({ status, prefs, setPrefs, clearSession }: { status: Status | null; prefs: Prefs; setPrefs(p: Partial<Prefs>): void; clearSession(): void }) {
  const [sys, setSys] = useState<NativeSettings | null>(null);
  useEffect(() => onNativeSettings(setSys), []);
  const set = (key: keyof NativeSettings, value: boolean | string) => { setSys(s => s && { ...s, [key]: value }); nativeSend({ type: 'set', key, value }); };
  return (
    <main className="ov-body ov-settings" aria-label="Settings">
      <section>
        <h2>About you</h2>
        <textarea value={prefs.profile} onChange={e => setPrefs({ profile: e.target.value })} maxLength={1000} rows={4}
          placeholder="e.g. I'm a sales rep at Acme selling solar panels to small businesses. Keep me confident and concise." aria-label="Context Cue should know about you" />
        <p className="ov-hint">Cue uses this in every answer. It stays on this Mac.</p>
      </section>
      <section>
        <h2>Answers</h2>
        <Segmented label="Answer length" value={prefs.length} options={[['short', 'Short'], ['detailed', 'Detailed']]} onChange={v => setPrefs({ length: v as Prefs['length'] })} />
      </section>
      <section>
        <Toggle label="Auto-suggest replies" hint="When they ask a question or finish talking, Cue writes a reply without you clicking." on={prefs.auto} onChange={v => setPrefs({ auto: v })} />
      </section>
      <section>
        <h2>Look</h2>
        <Segmented label="Glass" value={sys?.glass ?? 'regular'} options={[['regular', 'Frosted'], ['clear', 'Clear']]} onChange={v => set('glass', v)} disabled={!sys} />
      </section>
      <section>
        <h2>Privacy & startup</h2>
        <Toggle label="Hide from screen sharing" hint="Asks recording and sharing apps to leave the panel out. Each app decides." on={!!sys?.hide} onChange={v => set('hide', v)} disabled={!sys} />
        <Toggle label="Open at login" on={!!sys?.login} onChange={v => set('login', v)} disabled={!sys} />
      </section>
      <section>
        <h2>Session</h2>
        <p className="ov-row"><span>Show / hide</span><kbd>⌘\</kbd></p>
        <p className="ov-row"><span>What should I say?</span><kbd>⌘↵</kbd></p>
        <button className="ov-wide" onClick={clearSession}>Clear transcript & answers</button>
      </section>
      <p className="ov-hint ov-model">{status?.ai ? `Model: ${status.model || 'connected'}${status.vision ? ' · sees your screen' : ''}` : 'Model: offline'}</p>
    </main>
  );
}

function Segmented({ label, value, options, onChange, disabled }: { label: string; value: string; options: [string, string][]; onChange(v: string): void; disabled?: boolean }) {
  return (
    <div className="ov-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} disabled={disabled} onClick={() => onChange(v)}>{text}</button>)}
    </div>
  );
}

function Toggle({ label, hint, on, onChange, disabled }: { label: string; hint?: string; on: boolean; onChange(v: boolean): void; disabled?: boolean }) {
  return (
    <label className="ov-toggle">
      <span><span>{label}</span>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={e => onChange(e.target.checked)} />
    </label>
  );
}

// Replies come as "Say: <line>" plus backup points: show the line to read out big, the rest small.
function AnswerText({ text, done }: { text: string; done: boolean }) {
  const cursor = !done && text && <span className="cursor" />;
  if (!text) return <p className="text"><span className="ov-thinking">Thinking</span></p>;
  const m = text.match(/^\s*Say:\s*([^\n]*)\n?([\s\S]*)$/i);
  if (!m) return <p className="text">{text}{cursor}</p>;
  return <>
    <p className="ov-say">{m[1]}{!m[2].trim() && cursor}</p>
    {m[2].trim() && <p className="text ov-backup">{m[2].trim()}{cursor}</p>}
  </>;
}

const Icon = ({ d }: { d: string }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const MIC = 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3';
const WAVE = 'M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2';
const MIC_OFF = 'M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.9 5M19 11a7 7 0 0 1-.4 2.3M12 18v3';
const SPEAKER = 'M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13';
const SPEAKER_OFF = 'M11 5L6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6';
const DOC = 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6';
const CLOSE = 'M6 6l12 12M18 6L6 18';
const GEAR = 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z';
const SPARK = 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z';
