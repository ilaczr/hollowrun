const BLOCKED_ENVIRONMENT_KEYS = new Set([
  'electron_app',
  'electron_run_as_node',
  'steamappid',
  'steamgameid'
]);

export function createSteamHelperEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => {
    const normalizedKey = key.toLowerCase();
    return !BLOCKED_ENVIRONMENT_KEYS.has(normalizedKey)
      && !normalizedKey.startsWith('hollowrun_');
  }));
}

export function createIdleWorkerEnvironment(appId, environment = process.env) {
  const normalizedAppId = String(appId);
  return {
    ...createSteamHelperEnvironment(environment),
    SteamAppId: normalizedAppId,
    SteamGameId: normalizedAppId
  };
}
