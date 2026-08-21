const STEAM_DEBUG_ORIGIN = 'http://127.0.0.1:8080';
const STEAM_DEBUG_PORT = '8080';
const CDP_TIMEOUT_MS = 2500;
const SHORTCUT_TYPE_BITS = 0x02000000n;
let cachedSteamUiTarget = null;
let cachedSteamUiTargetAt = 0;

export function isValidShortcutAppId(value) {
  const appId = Number(value);
  return Number.isSafeInteger(appId) && appId > 0 && appId <= 0xffffffff && appId !== 480;
}

export function getShortcutGameId(value) {
  if (!isValidShortcutAppId(value)) return null;
  return ((BigInt(Number(value)) << 32n) | SHORTCUT_TYPE_BITS).toString();
}

export function normalizeSteamDebugTargets(targets) {
  if (!Array.isArray(targets)) return [];

  return targets.flatMap(target => {
    if (!target || typeof target !== 'object' || typeof target.webSocketDebuggerUrl !== 'string') return [];
    try {
      const debuggerUrl = new URL(target.webSocketDebuggerUrl);
      const isLocalHost = debuggerUrl.hostname === '127.0.0.1'
        || debuggerUrl.hostname === 'localhost'
        || debuggerUrl.hostname === '[::1]';
      if (debuggerUrl.protocol !== 'ws:'
        || debuggerUrl.port !== STEAM_DEBUG_PORT
        || !isLocalHost
        || !debuggerUrl.pathname.startsWith('/devtools/')) {
        return [];
      }
      return [{
        title: typeof target.title === 'string' ? target.title : '',
        url: typeof target.url === 'string' ? target.url : '',
        webSocketDebuggerUrl: debuggerUrl.href
      }];
    } catch {
      return [];
    }
  }).sort((left, right) => {
    const score = target => (/shared/i.test(target.title) ? 2 : 0)
      + (/steam/i.test(`${target.title} ${target.url}`) ? 1 : 0);
    return score(right) - score(left);
  }).slice(0, 8);
}

function serializeOptions(options) {
  const requestedRelaunchDelay = Number(options?.relaunchDelayMs);
  return JSON.stringify({
    appId: isValidShortcutAppId(options?.appId) ? Number(options.appId) : 0,
    name: String(options?.name || ''),
    executablePath: String(options?.executablePath || ''),
    startDirectory: String(options?.startDirectory || ''),
    launchOptions: String(options?.launchOptions || ''),
    restart: options?.restart === true,
    relaunchDelayMs: Number.isFinite(requestedRelaunchDelay)
      ? Math.max(0, Math.min(5000, Math.trunc(requestedRelaunchDelay)))
      : 2500
  });
}

export function buildConfigureGhostExpression(options) {
  const serializedOptions = serializeOptions(options);
  return `
    (async () => {
      const options = ${serializedOptions};
      const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const apps = globalThis.SteamClient?.Apps;
      const appStore = globalThis.appStore;
      const appInfoStore = globalThis.appInfoStore;
      const collectionStore = globalThis.collectionStore;
      let appId = options.appId;
      let created = false;

      try {
        if (!apps?.AddShortcut
          || !apps?.RunGame
          || !apps?.SetShortcutName
          || !apps?.SetShortcutExe
          || !apps?.SetShortcutStartDir
          || !apps?.SetShortcutLaunchOptions
          || !appStore?.GetAppOverviewByAppID) {
          return { success: false, appId: 0, hidden: false, error: 'Steam shortcut API is unavailable.' };
        }
        if (!collectionStore?.SetAppsAsHidden || !collectionStore?.BIsHidden) {
          return { success: false, appId: 0, hidden: false, error: 'Steam hidden collection is unavailable.' };
        }

        if (appId && !appStore.GetAppOverviewByAppID(appId)) {
          for (let attempt = 0; attempt < 15 && !appStore.GetAppOverviewByAppID(appId); attempt += 1) {
            await sleep(100);
          }
          if (!appStore.GetAppOverviewByAppID(appId)) appId = 0;
        }

        if (!appId) {
          appId = Number(await apps.AddShortcut(
            options.name,
            options.executablePath,
            options.startDirectory,
            options.launchOptions
          ));
          created = true;
        }

        if (!Number.isInteger(appId) || appId <= 0 || appId > 0xffffffff || appId === 480) {
          return { success: false, appId: 0, hidden: false, error: 'Steam returned an invalid shortcut AppID.' };
        }

        let overview = appStore.GetAppOverviewByAppID(appId);
        for (let attempt = 0; attempt < 40 && !overview; attempt += 1) {
          await sleep(100);
          overview = appStore.GetAppOverviewByAppID(appId);
        }
        if (!overview) {
          return { success: false, appId, created, hidden: false, error: 'Steam did not register the shortcut.' };
        }

        // AddShortcut's initial argument mapping has varied across Steam client
        // versions. Normalize every field through the dedicated setters before
        // the first launch as well as on later updates.
        await Promise.all([
          Promise.resolve(apps.SetShortcutName(appId, options.name)),
          Promise.resolve(apps.SetShortcutExe(appId, options.executablePath)),
          Promise.resolve(apps.SetShortcutStartDir(appId, options.startDirectory)),
          Promise.resolve(apps.SetShortcutLaunchOptions(appId, options.launchOptions))
        ]);

        if (appInfoStore?.GetAppDetails) {
          let shortcutReady = false;
          for (let attempt = 0; attempt < 30; attempt += 1) {
            const details = appInfoStore.GetAppDetails(appId);
            if (details?.strDisplayName === options.name
              && details?.strLaunchOptions === options.launchOptions) {
              shortcutReady = true;
              break;
            }
            await sleep(100);
          }
          if (!shortcutReady) {
            return {
              success: false,
              appId,
              created,
              hidden: false,
              error: 'Steam did not finish configuring the ghost shortcut.'
            };
          }
        } else if (created) {
          await sleep(500);
        }

        collectionStore.SetAppsAsHidden([appId], true);
        for (let attempt = 0; attempt < 20 && !collectionStore.BIsHidden(appId); attempt += 1) {
          await sleep(100);
          collectionStore.SetAppsAsHidden([appId], true);
        }
        const hidden = Boolean(collectionStore.BIsHidden(appId));
        if (!hidden) {
          return { success: false, appId, created, hidden: false, error: 'Steam did not hide the shortcut.' };
        }

        const gameId = ((BigInt(appId) << 32n) | 0x02000000n).toString();
        if (options.restart && apps.TerminateApp) {
          try {
            const runningStatus = overview.GetPerClientData?.('local')?.display_status;
            const stopStartedAt = Date.now();
            let readyToRelaunch = false;
            await Promise.resolve(apps.TerminateApp(gameId, false));
            while (Date.now() - stopStartedAt < 6000) {
              await sleep(100);
              const elapsed = Date.now() - stopStartedAt;
              const currentOverview = appStore.GetAppOverviewByAppID(appId);
              const currentStatus = currentOverview?.GetPerClientData?.('local')?.display_status;
              const runningStateCleared = runningStatus === undefined || currentStatus !== runningStatus;
              if (elapsed >= options.relaunchDelayMs && runningStateCleared) {
                readyToRelaunch = true;
                break;
              }
            }
            if (!readyToRelaunch) {
              return {
                success: false,
                appId,
                created,
                hidden: true,
                error: 'Steam is still stopping the previous ghost. Apply the status again in a few seconds.'
              };
            }
          } catch (error) {
            return {
              success: false,
              appId,
              created,
              hidden: true,
              error: error instanceof Error ? error.message : 'Steam could not stop the previous ghost.'
            };
          }
        }
        await Promise.resolve(apps.RunGame(gameId, '', -1, 100));
        return { success: true, appId, gameId, created, hidden: true };
      } catch (error) {
        return {
          success: false,
          appId: Number.isInteger(appId) ? appId : 0,
          created,
          hidden: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })()
  `;
}

export function buildStopGhostExpression(appId, { remove = false } = {}) {
  const normalizedAppId = isValidShortcutAppId(appId) ? Number(appId) : 0;
  return `
    (async () => {
      const appId = ${normalizedAppId};
      const apps = globalThis.SteamClient?.Apps;
      if (!appId || !apps?.TerminateApp) return { success: false, error: 'Steam shortcut API is unavailable.' };
      const gameId = ((BigInt(appId) << 32n) | 0x02000000n).toString();
      try {
        await Promise.resolve(apps.TerminateApp(gameId, false));
        ${remove ? "await new Promise(resolve => setTimeout(resolve, 650)); if (apps.RemoveShortcut) await Promise.resolve(apps.RemoveShortcut(appId));" : ''}
        return { success: true, appId, removed: ${remove ? 'true' : 'false'} };
      } catch (error) {
        return { success: false, appId, error: error instanceof Error ? error.message : String(error) };
      }
    })()
  `;
}

export function buildSteamLaunchActivityExpression() {
  return `
    (() => {
      const watcherKey = '__hollowRunGameLaunchWatcher';
      const apps = globalThis.SteamClient?.Apps;
      if (!apps?.RegisterForGameActionStart || !apps?.RegisterForGameActionEnd) {
        return { supported: false, revision: 0, lastGameId: '', lastAt: 0 };
      }

      let watcher = globalThis[watcherKey];
      if (!watcher) {
        watcher = {
          revision: 0,
          lastGameId: '',
          lastAt: 0,
          launches: new Map(),
          startHandle: null,
          endHandle: null
        };
        watcher.startHandle = apps.RegisterForGameActionStart((actionId, gameId, actionName) => {
          if (actionName === 'LaunchApp') watcher.launches.set(String(actionId), String(gameId));
        });
        watcher.endHandle = apps.RegisterForGameActionEnd(actionId => {
          const actionKey = String(actionId);
          const gameId = watcher.launches.get(actionKey);
          watcher.launches.delete(actionKey);
          if (!gameId) return;
          watcher.revision += 1;
          watcher.lastGameId = gameId;
          watcher.lastAt = Date.now();
        });
        globalThis[watcherKey] = watcher;
      }

      return {
        supported: true,
        revision: watcher.revision,
        lastGameId: watcher.lastGameId,
        lastAt: watcher.lastAt
      };
    })()
  `;
}

export function buildClearSteamLaunchWatcherExpression() {
  return `
    (() => {
      const watcherKey = '__hollowRunGameLaunchWatcher';
      const watcher = globalThis[watcherKey];
      if (!watcher) return { success: true };
      try { watcher.startHandle?.unregister?.(); } catch {}
      try { watcher.endHandle?.unregister?.(); } catch {}
      delete globalThis[watcherKey];
      return { success: true };
    })()
  `;
}

function evaluateCdpExpression(webSocketDebuggerUrl, expression, timeoutMs = CDP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { socket?.close(); } catch {}
      if (error) reject(error);
      else resolve(value);
    };
    const timeout = setTimeout(() => finish(new Error('Steam UI request timed out.')), timeoutMs);

    try {
      socket = new WebSocket(webSocketDebuggerUrl);
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true
          }
        }));
      });
      socket.addEventListener('message', event => {
        try {
          const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
          const message = JSON.parse(raw);
          if (message.id !== 1) return;
          if (message.error || message.result?.exceptionDetails) {
            finish(new Error('Steam UI rejected the request.'));
            return;
          }
          finish(null, message.result?.result?.value);
        } catch {
          finish(new Error('Steam UI returned an invalid response.'));
        }
      });
      socket.addEventListener('error', () => finish(new Error('Could not connect to the Steam UI.')));
      socket.addEventListener('close', () => finish(new Error('Steam UI connection closed.')));
    } catch {
      finish(new Error('Could not connect to the Steam UI.'));
    }
  });
}

async function discoverSteamUiTarget() {
  if (cachedSteamUiTarget && Date.now() - cachedSteamUiTargetAt < 5000) return cachedSteamUiTarget;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CDP_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${STEAM_DEBUG_ORIGIN}/json/list`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) return null;

  let targets;
  try {
    targets = normalizeSteamDebugTargets(await response.json());
  } catch {
    return null;
  }

  const probeExpression = `({
    shortcuts: Boolean(globalThis.SteamClient?.Apps?.AddShortcut),
    library: Boolean(globalThis.appStore?.GetAppOverviewByAppID),
    hidden: Boolean(globalThis.collectionStore?.SetAppsAsHidden)
  })`;
  for (const target of targets) {
    try {
      const capabilities = await evaluateCdpExpression(target.webSocketDebuggerUrl, probeExpression);
      if (capabilities?.shortcuts && capabilities?.library && capabilities?.hidden) {
        cachedSteamUiTarget = target;
        cachedSteamUiTargetAt = Date.now();
        return target;
      }
    } catch {}
  }
  return null;
}

export async function probeSteamGhostApi() {
  const target = await discoverSteamUiTarget();
  return { ready: Boolean(target) };
}

async function evaluateInSteamUi(expression, timeoutMs) {
  const target = await discoverSteamUiTarget();
  if (!target) throw new Error('Steam UI debugging is not ready. Restart Steam after enabling the ghost feature.');
  try {
    return await evaluateCdpExpression(target.webSocketDebuggerUrl, expression, timeoutMs);
  } catch (error) {
    cachedSteamUiTarget = null;
    cachedSteamUiTargetAt = 0;
    throw error;
  }
}

export function configureAndRunGhostShortcut(options) {
  return evaluateInSteamUi(buildConfigureGhostExpression(options), 12000);
}

export function stopGhostShortcut(appId, options) {
  return evaluateInSteamUi(buildStopGhostExpression(appId, options), 5000);
}

export async function readSteamLaunchActivity() {
  const result = await evaluateInSteamUi(buildSteamLaunchActivityExpression(), 5000);
  return {
    supported: result?.supported === true,
    revision: Number.isSafeInteger(result?.revision) && result.revision >= 0 ? result.revision : 0,
    lastGameId: typeof result?.lastGameId === 'string' ? result.lastGameId.slice(0, 32) : '',
    lastAt: Number.isFinite(result?.lastAt) && result.lastAt > 0 ? result.lastAt : 0
  };
}

export function clearSteamLaunchWatcher() {
  return evaluateInSteamUi(buildClearSteamLaunchWatcherExpression(), 5000);
}
