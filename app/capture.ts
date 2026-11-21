// Browser capture: mic captions (Web Speech API), screen share, screen frames, and tab-audio chunks.

type Recognition = { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const SpeechRecognition = (globalThis as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
  ?? (globalThis as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
export const canCaptionMic = !!SpeechRecognition;

// Live captions of the user's mic. onText(final, interim) fires as words come in. Returns stop().
export function captionMic(onText: (final: string, interim: string) => void, onError: (msg: string) => void) {
  if (!SpeechRecognition) { onError('Live captions need Chrome, Edge or Safari.'); return () => {}; }
  const rec = new SpeechRecognition();
  rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US';
  let running = true;
  rec.onresult = e => {
    let final = '', interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (final += e.results[i][0].transcript) : (interim += e.results[i][0].transcript));
    onText(final.trim(), interim.trim());
  };
  rec.onerror = e => { if (e.error === 'not-allowed') { running = false; onError('Microphone blocked. Allow it in the address bar.'); } };
  rec.onend = () => { if (running) rec.start(); }; // the browser stops after silence; keep listening
  rec.start();
  return () => { running = false; rec.stop(); };
}

export async function shareScreen() {
  return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: true }); // audio: the tab's sound, when the user ticks "share tab audio"
}

// One JPEG of the shared screen, at most 1280 px wide (enough to read text, small to send).
export async function grabFrame(stream: MediaStream): Promise<string | undefined> {
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState !== 'live') return;
  const video = document.createElement('video');
  video.srcObject = new MediaStream([track]); video.muted = true;
  await video.play();
  const scale = Math.min(1, 1280 / video.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  video.pause(); video.srcObject = null;
  return canvas.toDataURL('image/jpeg', 0.7);
}

// Records the shared tab's audio in self-contained chunks (a fresh recorder each time, so every chunk decodes on its own).
export function recordTabAudio(stream: MediaStream, onChunk: (blob: Blob) => void, everyMs = 7000) {
  const track = stream.getAudioTracks()[0];
  if (!track) return null;
  const audio = new MediaStream([track]);
  let rec: MediaRecorder | null = null, stopped = false;
  const cycle = () => {
    if (stopped || track.readyState !== 'live') return;
    rec = new MediaRecorder(audio, { mimeType: 'audio/webm' });
    rec.ondataavailable = e => { if (e.data.size > 2000) onChunk(e.data); }; // skip near-empty chunks (silence)
    rec.onstop = cycle;
    rec.start();
    setTimeout(() => rec?.state === 'recording' && rec.stop(), everyMs);
  };
  cycle();
  return () => { stopped = true; if (rec?.state === 'recording') rec.stop(); };
}

// Inside Cue.app (desktop/), the native shell does captions and screen capture. It calls window.__cue.*.
type NativeHandler = { postMessage(msg: unknown): void };
const nativeHandler = (window as unknown as { webkit?: { messageHandlers?: { cue?: NativeHandler } } }).webkit?.messageHandlers?.cue;
export const native = !!nativeHandler || new URLSearchParams(location.search).has('overlay'); // ?overlay previews the Cue.app layout in a browser
type Who = 'you' | 'them';
export interface NativeSettings { hide: boolean; login: boolean; glass: 'regular' | 'clear' }
let lastSettings: NativeSettings | undefined; // the shell may send these before React mounts
const hooks: { caption: Partial<Record<Who, (final: string, interim: string) => void>>; error?: (msg: string) => void; stopped?: (who: Who) => void; settings?: (s: NativeSettings) => void; visible?: (v: boolean) => void; frames: Map<number, (url?: string) => void> } = { caption: {}, frames: new Map() };
(window as unknown as { __cue: unknown }).__cue = {
  caption: (who: Who, final: string, interim: string) => hooks.caption[who]?.(final, interim),
  stopped: (who: Who) => { hooks.caption[who] = undefined; hooks.stopped?.(who); },
  error: (msg: string) => hooks.error?.(msg),
  settings: (s: NativeSettings) => { lastSettings = s; hooks.settings?.(s); },
  visible: (v: boolean) => hooks.visible?.(v),
  frame: (id: number, url?: string) => { hooks.frames.get(id)?.(url || undefined); hooks.frames.delete(id); },
};
export const onNativeEvents = (error: (msg: string) => void, stopped: (who: Who) => void) => { hooks.error = error; hooks.stopped = stopped; };
export const onNativeVisible = (fn: (v: boolean) => void) => { hooks.visible = fn; };
export const onNativeSettings = (fn: (s: NativeSettings) => void) => { hooks.settings = fn; if (lastSettings) fn(lastSettings); };
export const nativeSend = (msg: { type: string; [k: string]: unknown }) => nativeHandler?.postMessage(msg);

// "you" = your mic, "them" = what your Mac plays (the other people on a call). Each can be on or off on its own.
export function nativeCaptions(who: Who, onText: (final: string, interim: string) => void) {
  hooks.caption[who] = onText;
  nativeSend({ type: 'listen', source: who, on: true });
  return () => { nativeSend({ type: 'listen', source: who, on: false }); };
}

// A screenshot of what's behind the Cue panel (the panel itself is left out).
let frameSeq = 0;
export function nativeFrame(): Promise<string | undefined> {
  const id = ++frameSeq;
  return new Promise(resolve => {
    hooks.frames.set(id, resolve);
    nativeSend({ type: 'frame', id });
    setTimeout(() => { if (hooks.frames.delete(id)) resolve(undefined); }, 4000);
  });
}
