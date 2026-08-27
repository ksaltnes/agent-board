import { timingSafeEqual } from 'node:crypto';

export function tokensEqual(presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  const n = Math.max(a.length, b.length, 1);
  const pa = Buffer.alloc(n);
  const pb = Buffer.alloc(n);
  a.copy(pa);
  b.copy(pb);
  return timingSafeEqual(pa, pb) && a.length === b.length;
}

function headerValue(value) {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export function isAuthorized(req, opts = {}) {
  const token = opts.token ?? process.env.BOARD_TOKEN ?? '';
  const nodeEnv = opts.nodeEnv ?? process.env.NODE_ENV ?? '';
  if (!token) return nodeEnv !== 'production';
  const h = headerValue(req.headers?.authorization);
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
  const header = headerValue(req.headers?.['x-board-token']);
  return tokensEqual(bearer, token) || tokensEqual(header, token);
}
