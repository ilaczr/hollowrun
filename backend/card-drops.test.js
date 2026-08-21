import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCardDropCountWorkerOutput, parseCardDropWorkerOutput } from './card-drops.js';

const STEAM_ID = '76561198000000001';

test('parses and normalizes a successful card-drop worker response', () => {
  const output = [
    JSON.stringify({
      success: true,
      steamId: STEAM_ID,
      games: [
        { appId: 48000, dropsRemaining: 3 },
        { appId: 48000, dropsRemaining: 2 },
        { appId: 480, dropsRemaining: 1 },
        { appId: 10, dropsRemaining: 1 },
        { appId: 12345, dropsRemaining: null }
      ],
      incomplete: false,
      failedPages: 0,
      scannedPages: 24,
      totalPages: 24
    }),
    'Setting breakpad minidump AppID = 480'
  ].join('\n');

  assert.deepEqual(parseCardDropWorkerOutput(output, STEAM_ID), {
    success: true,
    progress: false,
    games: [
      { appId: 12345, dropsRemaining: null },
      { appId: 48000, dropsRemaining: 3 }
    ],
    incomplete: false,
    failedPages: 0,
    scannedPages: 24,
    totalPages: 24
  });
});

test('marks in-progress worker messages for streaming without exposing extra fields', () => {
  const output = JSON.stringify({
    success: true,
    status: 'SCANNING_CARD_DROPS',
    steamId: STEAM_ID,
    games: [{ appId: 48000, dropsRemaining: 3 }],
    incomplete: true,
    failedPages: 0,
    scannedPages: 7,
    totalPages: 24
  });

  assert.deepEqual(parseCardDropWorkerOutput(output, STEAM_ID), {
    success: true,
    progress: true,
    games: [{ appId: 48000, dropsRemaining: 3 }],
    incomplete: true,
    failedPages: 0,
    scannedPages: 7,
    totalPages: 24
  });
});

test('rejects a successful response from another Steam account', () => {
  const output = JSON.stringify({
    success: true,
    steamId: '76561198000000002',
    games: [{ appId: 48000, dropsRemaining: 3 }]
  });

  assert.equal(parseCardDropWorkerOutput(output, STEAM_ID), null);
});

test('keeps only known safe worker failure reasons', () => {
  assert.deepEqual(
    parseCardDropWorkerOutput('{"success":false,"reason":"client-auth-failed"}', STEAM_ID),
    { success: false, reason: 'client-auth-failed' }
  );
  assert.deepEqual(
    parseCardDropWorkerOutput('{"success":false,"reason":"secret-detail"}', STEAM_ID),
    { success: false, reason: 'unavailable' }
  );
});

test('parses a fresh per-game card-drop count including zero', () => {
  assert.deepEqual(
    parseCardDropCountWorkerOutput(
      JSON.stringify({ success: true, steamId: STEAM_ID, appId: 48000, dropsRemaining: 2 }),
      STEAM_ID,
      48000
    ),
    { success: true, steamId: STEAM_ID, appId: 48000, dropsRemaining: 2 }
  );
  assert.deepEqual(
    parseCardDropCountWorkerOutput(
      JSON.stringify({ success: true, steamId: STEAM_ID, appId: 48000, dropsRemaining: 0 }),
      STEAM_ID,
      48000
    ),
    { success: true, steamId: STEAM_ID, appId: 48000, dropsRemaining: 0 }
  );
});

test('rejects a per-game count for another account, app, or an invalid count', () => {
  assert.equal(
    parseCardDropCountWorkerOutput(
      JSON.stringify({ success: true, steamId: '76561198000000002', appId: 48000, dropsRemaining: 2 }),
      STEAM_ID,
      48000
    ),
    null
  );
  assert.equal(
    parseCardDropCountWorkerOutput(
      JSON.stringify({ success: true, steamId: STEAM_ID, appId: 12345, dropsRemaining: 2 }),
      STEAM_ID,
      48000
    ),
    null
  );
  assert.equal(
    parseCardDropCountWorkerOutput(
      JSON.stringify({ success: true, steamId: STEAM_ID, appId: 48000, dropsRemaining: -1 }),
      STEAM_ID,
      48000
    ),
    null
  );
});
