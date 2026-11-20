// Tiny server: serves the built game (dist/) and POST /api/line, which asks the model for a character's line.
// Runs with plain `node server/index.ts` (Node 23.6+ strips the types). Any OpenAI-compatible endpoint works,
// e.g. a vLLM/Ollama model on an Akamai Cloud GPU Linode.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { GameState } from '../shared/types.ts';
import { buildPrompt, parseLine, type LineKind } from '../game/voice.ts';

const { PORT = '8787', LLM_BASE_URL, LLM_API_KEY = '', LLM_MODEL = 'llama-3.1-8b-instruct' } = process.env;
const DIST = join(import.meta.dirname, '..', 'dist');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

async function line(body: { state: GameState; charId: string; kind: LineKind; to?: string }) {
  const c = body.state.characters.find(x => x.id === body.charId);
  if (!c || !['post', 'reply', 'defense'].includes(body.kind)) throw Object.assign(new Error('bad request'), { status: 400 });
  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${LLM_API_KEY}` },
    body: JSON.stringify({ model: LLM_MODEL, messages: buildPrompt(body.state, c, body.kind), max_tokens: 120, temperature: 0.9 }),
  });
  if (!res.ok) throw Object.assign(new Error(`model ${res.status}`), { status: 502 });
  const j = await res.json() as { choices: { message: { content: string } }[] };
  return parseLine(body.state, c, j.choices[0].message.content, body.to);
}

createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/line') {
      if (!LLM_BASE_URL) { res.writeHead(503).end('no model configured'); return; } // the client falls back to scripted lines
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 500_000) throw Object.assign(new Error('too large'), { status: 413 }); }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await line(JSON.parse(raw))));
      return;
    }
    const path = normalize(join(DIST, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)));
    if (!path.startsWith(DIST)) { res.writeHead(403).end(); return; }
    const file = await readFile(extname(path) ? path : join(DIST, 'index.html')).catch(() => null);
    if (!file) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'text/html' }).end(file);
  } catch (e) {
    const status = (e as { status?: number }).status ?? (e instanceof SyntaxError ? 400 : 500);
    res.writeHead(status).end(String((e as Error).message));
  }
}).listen(Number(PORT), () => console.log(`Who's the Bot? on http://localhost:${PORT} · model: ${LLM_BASE_URL ? LLM_MODEL : 'none (scripted lines)'}`));
