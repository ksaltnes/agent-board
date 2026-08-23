import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
mkdirSync(dir, { recursive: true });

const board = {
  v: 1,
  mandate: {
    goal: 'Ship a reliable multi-agent workflow with shared context and clear ownership.',
    done: 'All P0 tickets done; mandate goal met; no blocked tickets without owner.',
    focus: 'Bootstrap board + agent handoff loop',
    rules: [
      'Claim before work. One agent per ticket.',
      'Patch deltas only — never rewrite full tickets.',
      'Keep notes ≤140 chars. Link artifacts, don\'t paste them.',
      'Update status when blocked; name the blocker ticket id.',
    ],
  },
  agents: {
    planner: { role: 'breaks mandate into tickets', ticket: null },
    builder: { role: 'implements claimed tickets', ticket: null },
    reviewer: { role: 'verifies done criteria', ticket: null },
  },
  seq: 3,
  tickets: [
    {
      id: 'T1',
      t: 'Define mandate + done criteria',
      s: 'done',
      a: 'planner',
      p: 0,
      d: [],
      n: 'Seeded mandate in board.json',
      u: new Date().toISOString(),
    },
    {
      id: 'T2',
      t: 'Expose compact /ctx for bots',
      s: 'todo',
      a: null,
      p: 0,
      d: ['T1'],
      n: '',
      u: new Date().toISOString(),
    },
    {
      id: 'T3',
      t: 'Add human progress overview UI',
      s: 'todo',
      a: null,
      p: 1,
      d: ['T1'],
      n: '',
      u: new Date().toISOString(),
    },
  ],
};

writeFileSync(join(dir, 'board.json'), JSON.stringify(board, null, 2) + '\n');
console.log('seeded data/board.json');
