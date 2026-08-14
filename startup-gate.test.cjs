const assert = require('node:assert/strict');
const test = require('node:test');
const { isSteamClientReady } = require('./startup-gate.cjs');

test('accepts only a connected Steam client with a valid active user', () => {
  assert.equal(isSteamClientReady({
    success: true,
    steamClientConnected: true,
    activeUser: { steamId: '76561198000000000' }
  }), true);

  for (const status of [
    null,
    { success: false, steamClientConnected: true, activeUser: { steamId: '76561198000000000' } },
    { success: true, steamClientConnected: false, activeUser: { steamId: '76561198000000000' } },
    { success: true, steamClientConnected: true, activeUser: { steamId: 'N/A' } },
    { success: true, steamClientConnected: true, activeUser: null }
  ]) {
    assert.equal(isSteamClientReady(status), false);
  }
});
