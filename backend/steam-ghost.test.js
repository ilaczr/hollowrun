import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  buildClearSteamLaunchWatcherExpression,
  buildConfigureGhostExpression,
  buildSteamLaunchActivityExpression,
  buildStopGhostExpression,
  getShortcutGameId,
  isValidShortcutAppId,
  normalizeSteamDebugTargets
} from './steam-ghost.js';

test('validates shortcut AppIDs and keeps Spacewar blocked', () => {
  assert.equal(isValidShortcutAppId(480), false);
  assert.equal(isValidShortcutAppId(0), false);
  assert.equal(isValidShortcutAppId(0x100000000), false);
  assert.equal(isValidShortcutAppId(0x8abc1234), true);
});

test('converts a shortcut AppID to the matching Steam game ID', () => {
  assert.equal(getShortcutGameId(0x8abc1234), ((0x8abc1234n << 32n) | 0x02000000n).toString());
  assert.equal(getShortcutGameId(480), null);
});

test('accepts only local Steam debugger targets and prefers the shared context', () => {
  const targets = normalizeSteamDebugTargets([
    { title: 'Other', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:8080/devtools/page/2' },
    { title: 'SP Shared JS Context', url: 'steam://open/main', webSocketDebuggerUrl: 'ws://localhost:8080/devtools/page/1' },
    { title: 'Remote', url: '', webSocketDebuggerUrl: 'ws://example.com:8080/devtools/page/3' },
    { title: 'Wrong port', url: '', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/4' }
  ]);

  assert.equal(targets.length, 2);
  assert.equal(targets[0].title, 'SP Shared JS Context');
});

test('configures, hides, and launches a shortcut without evaluating label text', async () => {
  const calls = [];
  const hiddenAppIds = new Set();
  let displayStatus = 18;
  const expression = buildConfigureGhostExpression({
    appId: 0x8abc1234,
    name: 'Testing`; globalThis.injected = true; //',
    executablePath: 'C:\\Program Files\\HollowRun\\Worker.exe',
    startDirectory: 'C:\\Program Files\\HollowRun',
    launchOptions: '--presence-ghost "C:\\Temp\\ghost pulse"',
    restart: true,
    relaunchDelayMs: 0
  });

  const context = {
    SteamClient: {
      Apps: {
        AddShortcut: async (...args) => calls.push(['add', ...args]),
        SetShortcutName: async (...args) => calls.push(['name', ...args]),
        SetShortcutExe: async (...args) => calls.push(['exe', ...args]),
        SetShortcutStartDir: async (...args) => calls.push(['directory', ...args]),
        SetShortcutLaunchOptions: async (...args) => calls.push(['options', ...args]),
        RunGame: async (...args) => calls.push(['run', ...args]),
        TerminateApp: async (...args) => {
          calls.push(['stop', ...args]);
          displayStatus = 9;
        }
      }
    },
    appStore: {
      GetAppOverviewByAppID: appId => appId === 0x8abc1234
        ? { appid: appId, GetPerClientData: () => ({ display_status: displayStatus }) }
        : null
    },
    appInfoStore: {
      GetAppDetails: () => ({
        strDisplayName: 'Testing`; globalThis.injected = true; //',
        strLaunchOptions: '--presence-ghost "C:\\Temp\\ghost pulse"'
      })
    },
    collectionStore: {
      SetAppsAsHidden: appIds => appIds.forEach(appId => hiddenAppIds.add(appId)),
      BIsHidden: appId => hiddenAppIds.has(appId)
    },
    setTimeout
  };
  const result = await vm.runInNewContext(expression, context);

  assert.equal(result.success, true);
  assert.equal(result.hidden, true);
  assert.equal(result.appId, 0x8abc1234);
  assert.equal(calls.find(call => call[0] === 'name')[2], 'Testing`; globalThis.injected = true; //');
  assert.equal(context.injected, undefined);
  assert.ok(calls.findIndex(call => call[0] === 'stop') < calls.findIndex(call => call[0] === 'run'));
  assert.equal(calls.at(-1)[0], 'run');
  assert.equal(calls.at(-1)[1], getShortcutGameId(0x8abc1234));
});

test('normalizes a newly created shortcut before its first launch', async () => {
  const appId = 0x8def4567;
  const calls = [];
  const hiddenAppIds = new Set();
  const details = { strDisplayName: '', strLaunchOptions: '' };
  let registered = false;
  const expression = buildConfigureGhostExpression({
    name: 'First launch label',
    executablePath: 'C:\\HollowRun\\HollowRun.Worker.exe',
    startDirectory: 'C:\\HollowRun',
    launchOptions: '--presence-ghost "C:\\Temp\\heartbeat"',
    restart: false
  });

  const result = await vm.runInNewContext(expression, {
    SteamClient: {
      Apps: {
        AddShortcut: async (...args) => {
          calls.push(['add', ...args]);
          registered = true;
          return appId;
        },
        SetShortcutName: async (...args) => {
          calls.push(['name', ...args]);
          details.strDisplayName = args[1];
        },
        SetShortcutExe: async (...args) => calls.push(['exe', ...args]),
        SetShortcutStartDir: async (...args) => calls.push(['directory', ...args]),
        SetShortcutLaunchOptions: async (...args) => {
          calls.push(['options', ...args]);
          details.strLaunchOptions = args[1];
        },
        RunGame: async (...args) => calls.push(['run', ...args]),
        TerminateApp: async (...args) => calls.push(['stop', ...args])
      }
    },
    appStore: { GetAppOverviewByAppID: candidate => registered && candidate === appId ? { appid: candidate } : null },
    appInfoStore: { GetAppDetails: candidate => candidate === appId ? details : null },
    collectionStore: {
      SetAppsAsHidden: appIds => appIds.forEach(candidate => hiddenAppIds.add(candidate)),
      BIsHidden: candidate => hiddenAppIds.has(candidate)
    },
    setTimeout
  });

  assert.equal(result.success, true);
  assert.equal(result.created, true);
  assert.ok(calls.findIndex(call => call[0] === 'add') < calls.findIndex(call => call[0] === 'options'));
  assert.ok(calls.findIndex(call => call[0] === 'options') < calls.findIndex(call => call[0] === 'run'));
  assert.equal(calls.some(call => call[0] === 'stop'), false);
  assert.equal(details.strDisplayName, 'First launch label');
  assert.equal(details.strLaunchOptions, '--presence-ghost "C:\\Temp\\heartbeat"');
});

test('builds stop and remove expressions only for valid shortcuts', () => {
  assert.match(buildStopGhostExpression(0x8abc1234, { remove: true }), /RemoveShortcut/);
  assert.match(buildStopGhostExpression(480), /const appId = 0;/);
});

test('tracks completed Steam game launches and clears the watcher', () => {
  let startCallback;
  let endCallback;
  let registrationCount = 0;
  let unregisterCount = 0;
  const context = {
    SteamClient: {
      Apps: {
        RegisterForGameActionStart: callback => {
          registrationCount += 1;
          startCallback = callback;
          return { unregister: () => { unregisterCount += 1; } };
        },
        RegisterForGameActionEnd: callback => {
          registrationCount += 1;
          endCallback = callback;
          return { unregister: () => { unregisterCount += 1; } };
        }
      }
    }
  };

  let activity = vm.runInNewContext(buildSteamLaunchActivityExpression(), context);
  assert.deepEqual(
    { ...activity },
    { supported: true, revision: 0, lastGameId: '', lastAt: 0 }
  );
  assert.equal(registrationCount, 2);

  startCallback(17, '252950', 'LaunchApp');
  endCallback(17);
  activity = vm.runInNewContext(buildSteamLaunchActivityExpression(), context);
  assert.equal(activity.revision, 1);
  assert.equal(activity.lastGameId, '252950');
  assert.ok(activity.lastAt > 0);
  assert.equal(registrationCount, 2);

  startCallback(18, '570', 'OtherAction');
  endCallback(18);
  activity = vm.runInNewContext(buildSteamLaunchActivityExpression(), context);
  assert.equal(activity.revision, 1);

  const cleared = vm.runInNewContext(buildClearSteamLaunchWatcherExpression(), context);
  assert.equal(cleared.success, true);
  assert.equal(unregisterCount, 2);
  assert.equal(context.__hollowRunGameLaunchWatcher, undefined);
});
