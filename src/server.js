import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  load,
  save,
  ctxPack,
  progress,
  compactTicket,
  createTicket,
  patchTicket,
  claimTicket,
  patchMandate,
} from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3847);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

function send(res, status, body, compact = true) {
  const payload =
    typeof body === 'string' ? body : JSON.stringify(body, null, compact ? 0 : 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > 64_000) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function match(url, pattern) {
  const a = url.split('/').filter(Boolean);
  const b = pattern.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < b.length; i++) {
    if (b[i].startsWith(':')) params[b[i].slice(1)] = decodeURIComponent(a[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

async function api(req, res, path, query) {
  try {
    if (req.method === 'GET' && path === '/v1/ctx') {
      const board = load();
      return send(res, 200, ctxPack(board, query.a || null));
    }
    if (req.method === 'GET' && path === '/v1/progress') {
      return send(res, 200, progress(load()));
    }
    if (req.method === 'GET' && path === '/v1/mandate') {
      const m = load().mandate;
      return send(res, 200, { g: m.goal, d: m.done, f: m.focus, r: m.rules });
    }
    if (req.method === 'PATCH' && path === '/v1/mandate') {
      const body = await readBody(req);
      const board = load();
      const out = patchMandate(board, body);
      save(board);
      return send(res, 200, { ok: 1, ...out });
    }
    if (req.method === 'GET' && path === '/v1/tickets') {
      const board = load();
      let list = board.tickets;
      if (query.s) list = list.filter((t) => t.s === query.s);
      if (query.a) list = list.filter((t) => t.a === query.a);
      const compact = query.c !== '0';
      return send(res, 200, compact ? list.map(compactTicket) : list);
    }
    if (req.method === 'POST' && path === '/v1/tickets') {
      const body = await readBody(req);
      const board = load();
      const t = createTicket(board, body);
      save(board);
      // Minimal create ack — id + status only
      return send(res, 201, { ok: 1, id: t.id, s: t.s });
    }
    let m = match(path, '/v1/tickets/:id');
    if (m && req.method === 'GET') {
      const t = load().tickets.find((x) => x.id === m.id);
      if (!t) return send(res, 404, { err: 'not found' });
      return send(res, 200, compactTicket(t));
    }
    if (m && req.method === 'PATCH') {
      const body = await readBody(req);
      const board = load();
      const changed = patchTicket(board, m.id, body);
      save(board);
      return send(res, 200, { ok: 1, ...changed });
    }
    m = match(path, '/v1/tickets/:id/claim');
    if (m && req.method === 'POST') {
      const body = await readBody(req);
      const board = load();
      const t = claimTicket(board, m.id, body.a || query.a);
      save(board);
      return send(res, 200, { ok: 1, ...t });
    }
    m = match(path, '/v1/tickets/:id/done');
    if (m && req.method === 'POST') {
      const body = await readBody(req);
      const board = load();
      const changed = patchTicket(board, m.id, {
        s: 'done',
        n: body.n != null ? body.n : undefined,
      });
      save(board);
      return send(res, 200, { ok: 1, ...changed });
    }
    if (req.method === 'GET' && path === '/v1/board') {
      // Full board for UI (not for bots — use /ctx)
      return send(res, 200, load(), false);
    }
    if (req.method === 'GET' && path === '/v1/help') {
      return send(res, 200, {
        bot: {
          ctx: 'GET /v1/ctx?a=AGENT',
          create: 'POST /v1/tickets {"t":"title","p":0,"d":["T1"]}',
          patch: 'PATCH /v1/tickets/T2 {"s":"blocked","n":"waiting T1"}',
          claim: 'POST /v1/tickets/T2/claim {"a":"builder"}',
          done: 'POST /v1/tickets/T2/done {"n":"shipped"}',
          mandate: 'PATCH /v1/mandate {"f":"new focus"}',
        },
        keys: { t: 'title', s: 'status', a: 'agent', p: 'priority', d: 'deps', n: 'note≤140', g: 'goal', f: 'focus' },
      });
    }
    return send(res, 404, { err: 'not found' });
  } catch (e) {
    return send(res, e.status || 500, { err: e.message || 'error' });
  }
}

function staticFile(res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  if (rel.includes('..')) {
    res.writeHead(400);
    return res.end();
  }
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !existsSync(file)) {
    res.writeHead(404);
    return res.end('not found');
  }
  const ext = extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(readFileSync(file));
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (u.pathname.startsWith('/v1/')) {
    const query = Object.fromEntries(u.searchParams);
    return api(req, res, u.pathname, query);
  }
  if (req.method === 'GET') return staticFile(res, u.pathname);
  res.writeHead(405);
  res.end();
});

server.listen(PORT, () => {
  console.log(`agent-board http://127.0.0.1:${PORT}`);
  console.log(`bots: GET /v1/ctx  |  help: GET /v1/help`);
});
