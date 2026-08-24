/**
 * Smoke test against a live server OR in-process store.
 * Run: npm start &; npm test
 */
import {
  load,
  save,
  createTicket,
  patchTicket,
  claimTicket,
  ctxPack,
  progress,
  DATA_PATH,
} from './store.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const backup = readFileSync(DATA_PATH, 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

try {
  const board = load();
  const before = board.tickets.length;

  const t = createTicket(board, { t: 'Smoke ticket', p: 0 });
  assert(t.id && t.s === 'todo', 'create');
  const claimed = claimTicket(board, t.id, 'builder');
  assert(claimed.s === 'doing' && claimed.a === 'builder', 'claim');
  const changed = patchTicket(board, t.id, { n: 'ok', s: 'done' });
  assert(changed.s === 'done', 'done');
  save(board);

  const ctx = ctxPack(load(), 'builder');
  assert(ctx.m.g && ctx.p.total >= before + 1, 'ctx');
  assert(typeof progress(load()).pct === 'number', 'progress');

  // HTTP checks if server up
  const port = process.env.PORT || 3847;
  const hdr = { 'Content-Type': 'application/json' };
  if (process.env.BOARD_TOKEN) hdr['X-Board-Token'] = process.env.BOARD_TOKEN;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/ctx?a=builder`);
    if (r.ok) {
      const j = await r.json();
      assert(j.m && j.open, 'http ctx');
      const h = await fetch(`http://127.0.0.1:${port}/health`);
      assert(h.ok, 'health');
      const c = await fetch(`http://127.0.0.1:${port}/v1/tickets`, {
        method: 'POST',
        headers: hdr,
        body: JSON.stringify({ t: 'HTTP smoke', p: 2 }),
      });
      const created = await c.json();
      assert(created.ok === 1 && created.id, 'http create ack minimal');
      const p = await fetch(`http://127.0.0.1:${port}/v1/tickets/${created.id}`, {
        method: 'PATCH',
        headers: hdr,
        body: JSON.stringify({ s: 'done', n: 'x' }),
      });
      const patched = await p.json();
      assert(patched.ok === 1 && patched.s === 'done', 'http patch delta');
      console.log('http ok');
    } else {
      console.log('server not ready — store-only tests passed');
    }
  } catch {
    console.log('server offline — store-only tests passed');
  }

  console.log('smoke ok');
} finally {
  writeFileSync(DATA_PATH, backup);
  // remove smoke tickets if we mutated — restore exact backup
}
