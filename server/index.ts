// Cue server: serves the built app (dist/) and the API. Runs with `node server/index.ts` (Node 23.6+).
// Model: Akamai Cloud Inference through its OpenAI-compatible API. Recaps: Akamai Object Storage (S3 API).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { askMessages, parseRecap, recapChecks, recapMessages, type AskRequest, type Line, type SavedRecap } from '../shared/cue.ts';

const env = process.env;
const PORT = Number(env.PORT ?? 8787);
const AI = env.AI_BASE_URL?.replace(/\/$/, '');
const VISION = env.AI_VISION === '1';
const S3 = env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY
  ? { url: `${env.S3_ENDPOINT.replace(/\/$/, '')}/${env.S3_BUCKET}/recaps`, aws: new AwsClient({ accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY, service: 's3', region: env.S3_REGION ?? 'us-east-1' }) }
  : null;
const DIST = join(import.meta.dirname, '..', 'dist');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }

async function body(req: IncomingMessage, max: number) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > max) throw new HttpError(413, 'too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}
const json = async <T,>(req: IncomingMessage, max: number): Promise<T> => { try { return JSON.parse((await body(req, max)).toString()); } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, 'bad json'); } };
const send = (res: ServerResponse, status: number, data: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
const validLines = (x: unknown): Line[] => Array.isArray(x) ? x.filter(l => l && (l.who === 'you' || l.who === 'them') && typeof l.text === 'string').slice(-2000) : [];

async function model(path: string, init: RequestInit) {
  if (!AI) throw new HttpError(503, 'AI_BASE_URL is not set');
  const res = await fetch(AI + path, { ...init, headers: { authorization: `Bearer ${env.AI_API_KEY ?? ''}`, ...init.headers }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new HttpError(502, `model ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}
const chat = (messages: unknown, stream: boolean) => model('/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: env.AI_MODEL, messages, stream, max_tokens: stream ? 300 : 900, temperature: 0.3 }) });

// POST /api/ask → streams the answer as plain text chunks.
async function ask(req: IncomingMessage, res: ServerResponse) {
  const r = await json<AskRequest>(req, 6_000_000);
  if (!['say', 'screen', 'summary', 'followups', 'ask'].includes(r.mode)) throw new HttpError(400, 'bad mode');
  r.lines = validLines(r.lines);
  if (typeof r.image !== 'string' || !r.image.startsWith('data:image/')) r.image = undefined;
  r.profile = typeof r.profile === 'string' ? r.profile.slice(0, 1000) : undefined;
  if (r.length !== 'detailed') r.length = 'short';
  const upstream = await chat(askMessages(r, VISION), true);
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  const decoder = new TextDecoder(); let buf = '';
  for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    const events = buf.split('\n'); buf = events.pop()!;
    for (const e of events) {
      if (!e.startsWith('data:') || e.includes('[DONE]')) continue;
      try { const d = JSON.parse(e.slice(5)).choices?.[0]?.delta?.content; if (d) res.write(d); } catch { /* keep-alive or partial line */ }
    }
  }
  res.end();
}

// POST /api/transcribe (raw audio) → { text }. Captions for the other side of a call (shared tab audio).
async function transcribe(req: IncomingMessage, res: ServerResponse) {
  if (!env.STT_MODEL) throw new HttpError(503, 'STT_MODEL is not set');
  const audio = await body(req, 8_000_000);
  const form = new FormData();
  form.append('file', new Blob([audio], { type: req.headers['content-type'] ?? 'audio/webm' }), 'chunk.webm');
  form.append('model', env.STT_MODEL);
  const r = await model('/audio/transcriptions', { method: 'POST', body: form });
  send(res, 200, { text: String(((await r.json()) as { text?: string }).text ?? '').trim() });
}

// POST /api/recap { lines } → AI recap with checked quotes, saved to Object Storage when configured.
async function recap(req: IncomingMessage, res: ServerResponse) {
  const lines = validLines((await json<{ lines: unknown }>(req, 3_000_000)).lines);
  const r = await chat(recapMessages(lines), false);
  const raw = ((await r.json()) as { choices: { message: { content: string } }[] }).choices[0].message.content;
  let parsed;
  try { parsed = parseRecap(raw); } catch { throw new HttpError(502, 'model did not return a recap'); }
  const saved: SavedRecap = { id: S3 ? randomUUID() : '', createdAt: new Date().toISOString(), recap: parsed, checks: recapChecks(parsed, lines), lines };
  if (S3) {
    const put = await S3.aws.fetch(`${S3.url}/${saved.id}.json`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(saved) });
    if (!put.ok) throw new HttpError(502, `object storage ${put.status}`);
  }
  send(res, 200, saved);
}

async function getRecap(id: string, res: ServerResponse) {
  if (!S3) throw new HttpError(503, 'object storage is not set up');
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, 'not found');
  const r = await S3.aws.fetch(`${S3.url}/${id}.json`);
  if (r.status === 404 || r.status === 403) throw new HttpError(404, 'not found');
  if (!r.ok) throw new HttpError(502, `object storage ${r.status}`);
  res.writeHead(200, { 'content-type': 'application/json' }).end(await r.text());
}

async function staticFile(url: string, res: ServerResponse) {
  const path = normalize(join(DIST, decodeURIComponent(new URL(url, 'http://x').pathname)));
  if (!path.startsWith(DIST)) throw new HttpError(403, 'forbidden');
  const file = await readFile(extname(path) ? path : join(DIST, 'index.html')).catch(() => null); // no extension = app route (e.g. /r/<id>)
  if (!file) throw new HttpError(404, 'not found');
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'text/html' }).end(file);
}

createServer(async (req, res) => {
  const url = req.url ?? '/';
  try {
    if (req.method === 'GET' && url === '/api/status') return send(res, 200, { ai: !!AI, model: AI ? env.AI_MODEL ?? '' : '', vision: VISION, stt: !!(AI && env.STT_MODEL), storage: !!S3 });
    if (req.method === 'POST' && url === '/api/ask') return await ask(req, res);
    if (req.method === 'POST' && url === '/api/transcribe') return await transcribe(req, res);
    if (req.method === 'POST' && url === '/api/recap') return await recap(req, res);
    if (req.method === 'GET' && url.startsWith('/api/recap/')) return await getRecap(url.slice(11), res);
    if (req.method === 'GET') return await staticFile(url, res);
    throw new HttpError(405, 'method not allowed');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error(e);
    if (res.headersSent) res.end(); else send(res, status, { error: (e as Error).message });
  }
}).listen(PORT, () => console.log(`Cue on http://localhost:${PORT} · model ${AI ? env.AI_MODEL : 'not set'} · speech ${env.STT_MODEL ?? 'not set'} · storage ${S3 ? env.S3_BUCKET : 'not set'}`));
