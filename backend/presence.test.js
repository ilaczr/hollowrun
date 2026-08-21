import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CUSTOM_PRESENCE_BYTES, normalizeCustomPresence } from './presence.js';

test('normalizes custom Steam presence text', () => {
  assert.equal(normalizeCustomPresence('  Exploring\nThe Hollow  '), 'Exploring The Hollow');
  assert.equal(normalizeCustomPresence('Running\u0000quietly'), 'Running quietly');
});

test('rejects missing, empty, and oversized custom Steam presence text', () => {
  for (const value of [null, undefined, 42, '', ' \n\t ']) {
    assert.equal(normalizeCustomPresence(value), null);
  }

  assert.equal(normalizeCustomPresence('a'.repeat(MAX_CUSTOM_PRESENCE_BYTES)), 'a'.repeat(MAX_CUSTOM_PRESENCE_BYTES));
  assert.equal(normalizeCustomPresence('é'.repeat((MAX_CUSTOM_PRESENCE_BYTES / 2) + 1)), null);
});
