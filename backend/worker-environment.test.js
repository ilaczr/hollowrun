import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createIdleWorkerEnvironment,
  createSteamHelperEnvironment
} from './worker-environment.js';

const parentEnvironment = {
  Path: 'C:\\Windows\\System32',
  USERPROFILE: 'C:\\Users\\Player',
  ELECTRON_APP: 'true',
  Electron_Run_As_Node: '1',
  HOLLOWRUN_INSTANCE_TOKEN: 'private-instance-token',
  HOLLOWRUN_SENTRY_DSN: 'private-destination',
  HOLLOWRUN_USER_DATA: 'C:\\Users\\Player\\AppData\\Roaming\\HollowRun',
  steamAppId: 'old-app',
  STEAMGAMEID: 'old-game'
};

test('Steam helpers inherit operating-system state without application secrets', () => {
  assert.deepEqual(createSteamHelperEnvironment(parentEnvironment), {
    Path: 'C:\\Windows\\System32',
    USERPROFILE: 'C:\\Users\\Player'
  });
});

test('idle workers receive only their canonical Steam AppID variables', () => {
  assert.deepEqual(createIdleWorkerEnvironment(730, parentEnvironment), {
    Path: 'C:\\Windows\\System32',
    USERPROFILE: 'C:\\Users\\Player',
    SteamAppId: '730',
    SteamGameId: '730'
  });
});
