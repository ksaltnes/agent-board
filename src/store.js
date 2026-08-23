import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_PATH = join(__dirname, '..', 'data', 'board.json');

const STATUSES = new Set(['todo', 'doing', 'blocked', 'done']);

function emptyBoard() {
  return {
    v: 1,
    mandate: { goal: '', done: '', focus: '', rules: [] },
    agents: {},
    seq: 0,
    tickets: [],
  };
}

export function load() {
  if (!existsSync(DATA_PATH)) {
    mkdirSync(dirname(DATA_PATH), { recursive: true });
    const b = emptyBoard();
    save(b);
    return b;
  }
  return JSON.parse(readFileSync(DATA_PATH, 'utf8'));
}

export function save(board) {
  mkdirSync(dirname(DATA_PATH), { recursive: true });
  const tmp = DATA_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(board, null, 2) + '\n');
  renameSync(tmp, DATA_PATH);
}

export function progress(board) {
  const counts = { todo: 0, doing: 0, blocked: 0, done: 0 };
  for (const t of board.tickets) counts[t.s] = (counts[t.s] || 0) + 1;
  const total = board.tickets.length;
  const done = counts.done || 0;
  return {
    total,
    done,
    pct: total ? Math.round((done / total) * 100) : 0,
    counts,
    focus: board.mandate.focus || '',
  };
}

/** Compact context pack — one round-trip for bots */
export function ctxPack(board, agentId) {
  const open = board.tickets
    .filter((t) => t.s !== 'done')
    .map(compactTicket);
  const mine = agentId
    ? open.filter((t) => t.a === agentId)
    : [];
  const claimable = open.filter(
    (t) => !t.a && t.s === 'todo' && depsMet(board, t),
  );
  return {
    m: {
      g: board.mandate.goal,
      d: board.mandate.done,
      f: board.mandate.focus,
      r: board.mandate.rules,
    },
    p: progress(board),
    open,
    mine,
    claimable,
    agents: Object.fromEntries(
      Object.entries(board.agents).map(([id, a]) => [id, { role: a.role, t: a.ticket }]),
    ),
  };
}

export function compactTicket(t) {
  const out = { id: t.id, t: t.t, s: t.s, p: t.p };
  if (t.a) out.a = t.a;
  if (t.d?.length) out.d = t.d;
  if (t.n) out.n = t.n;
  return out;
}

function depsMet(board, ticket) {
  if (!ticket.d?.length) return true;
  const byId = Object.fromEntries(board.tickets.map((x) => [x.id, x]));
  return ticket.d.every((id) => byId[id]?.s === 'done');
}

export function createTicket(board, body) {
  const title = (body.t ?? body.title ?? '').trim();
  if (!title) throw httpError(400, 't required');
  board.seq += 1;
  const id = body.id || `T${board.seq}`;
  if (board.tickets.some((t) => t.id === id)) throw httpError(409, 'id exists');
  const ticket = {
    id,
    t: title.slice(0, 120),
    s: body.s && STATUSES.has(body.s) ? body.s : 'todo',
    a: body.a ?? null,
    p: Number.isFinite(+body.p) ? +body.p : 1,
    d: Array.isArray(body.d) ? body.d : [],
    n: String(body.n ?? '').slice(0, 140),
    u: new Date().toISOString(),
  };
  board.tickets.push(ticket);
  return ticket;
}

export function patchTicket(board, id, body) {
  const ticket = board.tickets.find((t) => t.id === id);
  if (!ticket) throw httpError(404, 'not found');
  const changed = { id };
  if (body.t != null || body.title != null) {
    ticket.t = String(body.t ?? body.title).trim().slice(0, 120);
    changed.t = ticket.t;
  }
  if (body.s != null) {
    if (!STATUSES.has(body.s)) throw httpError(400, 'bad s');
    ticket.s = body.s;
    changed.s = ticket.s;
    if (ticket.s === 'done' && ticket.a && board.agents[ticket.a]) {
      board.agents[ticket.a].ticket = null;
    }
  }
  if (body.a !== undefined) {
    ticket.a = body.a || null;
    changed.a = ticket.a;
  }
  if (body.p != null) {
    ticket.p = +body.p;
    changed.p = ticket.p;
  }
  if (body.d != null) {
    ticket.d = Array.isArray(body.d) ? body.d : [];
    changed.d = ticket.d;
  }
  if (body.n != null) {
    ticket.n = String(body.n).slice(0, 140);
    changed.n = ticket.n;
  }
  ticket.u = new Date().toISOString();
  return changed;
}

export function claimTicket(board, id, agentId) {
  if (!agentId) throw httpError(400, 'a required');
  if (!board.agents[agentId]) {
    board.agents[agentId] = { role: 'agent', ticket: null };
  }
  const ticket = board.tickets.find((t) => t.id === id);
  if (!ticket) throw httpError(404, 'not found');
  if (ticket.s === 'done') throw httpError(409, 'already done');
  if (ticket.a && ticket.a !== agentId) throw httpError(409, `owned by ${ticket.a}`);
  if (!depsMet(board, ticket)) throw httpError(409, 'deps open');
  // release previous claim for this agent
  for (const t of board.tickets) {
    if (t.a === agentId && t.id !== id && t.s === 'doing') {
      t.s = 'todo';
      t.a = null;
      t.u = new Date().toISOString();
    }
  }
  ticket.a = agentId;
  ticket.s = 'doing';
  ticket.u = new Date().toISOString();
  board.agents[agentId].ticket = id;
  return compactTicket(ticket);
}

export function patchMandate(board, body) {
  const m = board.mandate;
  const out = {};
  if (body.goal != null || body.g != null) {
    m.goal = String(body.goal ?? body.g);
    out.g = m.goal;
  }
  if (body.done != null || body.d != null) {
    m.done = String(body.done ?? body.d);
    out.d = m.done;
  }
  if (body.focus != null || body.f != null) {
    m.focus = String(body.focus ?? body.f);
    out.f = m.focus;
  }
  if (body.rules != null || body.r != null) {
    m.rules = body.rules ?? body.r;
    out.r = m.rules;
  }
  return out;
}

function httpError(status, msg) {
  const e = new Error(msg);
  e.status = status;
  return e;
}
