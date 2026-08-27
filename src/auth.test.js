import test from 'node:test';
import assert from 'node:assert/strict';
import { tokensEqual, isAuthorized } from './auth.js';

test('tokensEqual accepts identical strings', () => {
  assert.equal(tokensEqual('s3cret-token', 's3cret-token'), true);
});

test('tokensEqual rejects a mismatched token of the same length', () => {
  assert.equal(tokensEqual('s3cret-token', 's3cret-t0ken'), false);
});

test('tokensEqual rejects different lengths without throwing', () => {
  assert.equal(tokensEqual('ab', 'abc'), false);
  assert.equal(tokensEqual('', 'x'), false);
});

test('isAuthorized fail-opens in non-production when BOARD_TOKEN is unset', () => {
  const ok = isAuthorized(
    { headers: {} },
    { token: '', nodeEnv: 'development' },
  );
  assert.equal(ok, true);
});

test('isAuthorized fail-closes in production when BOARD_TOKEN is unset', () => {
  const ok = isAuthorized(
    { headers: {} },
    { token: '', nodeEnv: 'production' },
  );
  assert.equal(ok, false);
});

test('isAuthorized accepts Bearer token', () => {
  const ok = isAuthorized(
    { headers: { authorization: 'Bearer s3cret' } },
    { token: 's3cret', nodeEnv: 'production' },
  );
  assert.equal(ok, true);
});

test('isAuthorized accepts X-Board-Token', () => {
  const ok = isAuthorized(
    { headers: { 'x-board-token': 's3cret' } },
    { token: 's3cret', nodeEnv: 'production' },
  );
  assert.equal(ok, true);
});

test('isAuthorized rejects a wrong token', () => {
  const ok = isAuthorized(
    { headers: { authorization: 'Bearer wrong' } },
    { token: 's3cret', nodeEnv: 'production' },
  );
  assert.equal(ok, false);
});

test('isAuthorized rejects an empty presented token when one is configured', () => {
  const ok = isAuthorized(
    { headers: {} },
    { token: 's3cret', nodeEnv: 'development' },
  );
  assert.equal(ok, false);
});
