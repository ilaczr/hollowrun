import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_APP_ID, MAX_IDLE_SESSIONS, normalizeGameName, parseAppId } from './validation.js';

test('allows up to Steam\'s 32 simultaneous played AppIDs', () => {
  assert.equal(MAX_IDLE_SESSIONS, 32);
});

test('parseAppId accepts valid integer IDs', () => {
  assert.equal(parseAppId(730), 730);
  assert.equal(parseAppId(' 730 '), 730);
  assert.equal(parseAppId(String(MAX_APP_ID)), MAX_APP_ID);
});

test('parseAppId rejects malformed or out-of-range values', () => {
  for (const value of [null, undefined, {}, [], '', '1.5', '1e2', '../730', 0, -1, MAX_APP_ID + 1, NaN]) {
    assert.equal(parseAppId(value), null);
  }
});

test('normalizeGameName removes control characters and limits length', () => {
  assert.equal(normalizeGameName('  Test\u0000 Game  ', 730), 'Test Game');
  assert.equal(normalizeGameName('', 730), 'AppID 730');
  assert.equal(normalizeGameName('x'.repeat(200), 730).length, 120);
});
