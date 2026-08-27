import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seed = readFileSync(join(root, 'data', 'board.json'), 'utf8');

const DATA_PATHS = [
  '/v1/ctx',
  '/v1/progress',
  '/v1/mandate',
  '/v1/tickets',
  '/v1/tickets/T1',
  '/v1/board',
  '/v1/help',
];

function spawnServer(extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-board-'));
  writeFileSync(join(dir, 'board.json'), seed);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, ...extraEnv, PORT: String(port), DATA_DIR: dir };
  if (!Object.prototype.hasOwnProperty.call(extraEnv, 'BOARD_TOKEN')) {
    delete env.BOARD_TOKEN;
  } else if (extraEnv.BOARD_TOKEN === '') {
    delete env.BOARD_TOKEN;
  }
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => {
    stderr += c.toString();
  });
  return { child, port, dir, stderr: () => stderr };
}

async function waitHealth(port) {
  const url = `http://127.0.0.1:${port}/health`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 200) {
        const j = await r.json();
        if (j.ok === 1) return;
      }
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`server on ${port} did not become healthy`);
}

async function withServer(extraEnv, fn) {
  const s = spawnServer(extraEnv);
  try {
    await waitHealth(s.port);
    return await fn(s.port);
  } finally {
    s.child.kill('SIGTERM');
    await new Promise((r) => {
      const t = setTimeout(r, 1000);
      s.child.once('exit', () => {
        clearTimeout(t);
        r();
      });
    });
  }
}

test('GET /health stays public and returns {"ok":1}', async () => {
  await withServer({ BOARD_TOKEN: 'test-token', NODE_ENV: 'production' }, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: 1 });
  });
});

test('static unlock shell stays reachable without a token', async () => {
  await withServer({ BOARD_TOKEN: 'test-token', NODE_ENV: 'production' }, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /board-token/);
    assert.doesNotMatch(html, /family-meal-planner/);
  });
});

test('unauthenticated GET of board data paths returns 401 when token is set', async () => {
  await withServer({ BOARD_TOKEN: 'test-token', NODE_ENV: 'production' }, async (port) => {
    for (const path of DATA_PATHS) {
      const r = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(r.status, 401, path);
      const j = await r.json();
      assert.equal(j.err, 'token required');
    }
  });
});

test('valid token can read and write', async () => {
  await withServer({ BOARD_TOKEN: 'test-token', NODE_ENV: 'production' }, async (port) => {
    const headers = { 'X-Board-Token': 'test-token', 'Content-Type': 'application/json' };
    const board = await fetch(`http://127.0.0.1:${port}/v1/board`, { headers });
    assert.equal(board.status, 200);
    const body = await board.json();
    assert.ok(body.mandate);
    assert.ok(Array.isArray(body.tickets));

    const created = await fetch(`http://127.0.0.1:${port}/v1/tickets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ t: 'Auth write check', p: 2 }),
    });
    assert.equal(created.status, 201);
    const ack = await created.json();
    assert.equal(ack.ok, 1);
    assert.ok(ack.id);

    const bearer = await fetch(`http://127.0.0.1:${port}/v1/tickets/${ack.id}`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    assert.equal(bearer.status, 200);
  });
});

test('wrong token is rejected for reads and writes', async () => {
  await withServer({ BOARD_TOKEN: 'test-token', NODE_ENV: 'production' }, async (port) => {
    const headers = { 'X-Board-Token': 'nope', 'Content-Type': 'application/json' };
    const get = await fetch(`http://127.0.0.1:${port}/v1/board`, { headers });
    assert.equal(get.status, 401);
    const post = await fetch(`http://127.0.0.1:${port}/v1/tickets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ t: 'nope', p: 2 }),
    });
    assert.equal(post.status, 401);
  });
});

test('missing token in production does not serve the board', async () => {
  await withServer({ BOARD_TOKEN: '', NODE_ENV: 'production' }, async (port) => {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: 1 });

    const board = await fetch(`http://127.0.0.1:${port}/v1/board`);
    assert.equal(board.status, 401);
    const ctx = await fetch(`http://127.0.0.1:${port}/v1/ctx`);
    assert.equal(ctx.status, 401);
  });
});
