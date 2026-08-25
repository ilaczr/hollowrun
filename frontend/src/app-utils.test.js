import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatDropsLeft,
  formatPlaytime,
  formatTimer,
  getLastPlayedTime,
  getPaginationItems,
  normalizeCardDropGames,
  parseStoredTaskQueue
} from './app-utils.js';

test('normalizes card-drop results and rejects unsafe or duplicate AppIDs', () => {
  assert.deepEqual(normalizeCardDropGames([
    { appId: '730', dropsRemaining: '2' },
    { appId: 730, dropsRemaining: 1 },
    { appId: 480, dropsRemaining: 4 },
    { appId: 10, dropsRemaining: 1 },
    { appId: 440, dropsRemaining: 0 }
  ]), [
    { appId: 730, dropsRemaining: 2 },
    { appId: 440, dropsRemaining: null }
  ]);
});

test('formats session and card metadata consistently', () => {
  assert.equal(formatTimer(3661), '01:01:01');
  assert.equal(formatPlaytime(45), '45m');
  assert.equal(formatPlaytime(90), '1.5h');
  assert.equal(formatPlaytime(0), null);
  assert.equal(formatDropsLeft(1), '1 drop left');
  assert.equal(formatDropsLeft(3), '3 drops left');
  assert.equal(formatDropsLeft(null), 'Drops remaining');
});

test('creates compact pagination around the current page', () => {
  assert.deepEqual(getPaginationItems(2, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(getPaginationItems(1, 10), [1, 2, 3, 4, 5, 'ellipsis-end', 10]);
  assert.deepEqual(getPaginationItems(5, 10), [1, 'ellipsis-start', 4, 5, 6, 'ellipsis-end', 10]);
  assert.deepEqual(getPaginationItems(9, 10), [1, 'ellipsis-start', 6, 7, 8, 9, 10]);
});

test('normalizes recent-play timestamps for filtering and sorting', () => {
  assert.equal(getLastPlayedTime({ lastPlayed: 1_700_000_000 }), 1_700_000_000_000);
  assert.equal(
    getLastPlayedTime({ lastPlayedDate: '2025-01-02T03:04:05.000Z' }),
    Date.parse('2025-01-02T03:04:05.000Z')
  );
  assert.equal(getLastPlayedTime({ lastPlayed: 0, lastPlayedDate: 'invalid' }), 0);
  assert.equal(getLastPlayedTime(null), 0);
});

test('restores the full valid task queue without the former undefined cap', () => {
  const stored = Array.from({ length: 40 }, (_, index) => ({
    appId: 1000 + index,
    name: ` Game ${index} `,
    dropsRemaining: index + 1
  }));
  stored.push({ appId: 1000, name: 'duplicate' });
  stored.push({ appId: 480, name: 'blocked' });
  stored.push({ appId: 'invalid', name: 'invalid' });

  const queue = parseStoredTaskQueue(stored);
  assert.equal(queue.length, 40);
  assert.deepEqual(queue[0], { appId: 1000, name: 'Game 0', dropsRemaining: 1 });
  assert.deepEqual(queue.at(-1), { appId: 1039, name: 'Game 39', dropsRemaining: 40 });
});
