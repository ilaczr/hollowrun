import { parseAppId } from './validation.js';

const FAILURE_REASONS = new Set([
  'client-auth-failed',
  'steam-client-unavailable',
  'unavailable'
]);

function parseNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

export function parseCardDropWorkerOutput(stdout, expectedSteamId) {
  const steamId = String(expectedSteamId || '');
  if (!/^7656\d{13}$/.test(steamId) || typeof stdout !== 'string') return null;

  const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    let result;
    try {
      result = JSON.parse(line);
    } catch {
      continue;
    }

    if (result?.success === false) {
      const reason = FAILURE_REASONS.has(result.reason) ? result.reason : 'unavailable';
      return { success: false, reason };
    }
    if (result?.success !== true || result.steamId !== steamId || !Array.isArray(result.games)) continue;

    const gamesByAppId = new Map();
    for (const game of result.games) {
      const appId = parseAppId(game?.appId);
      if (appId === null || appId <= 10 || appId === 480) continue;

      const rawCount = Number(game?.dropsRemaining);
      const dropsRemaining = Number.isSafeInteger(rawCount) && rawCount > 0 ? rawCount : null;
      const existing = gamesByAppId.get(appId);
      if (!existing || (dropsRemaining ?? 0) > (existing.dropsRemaining ?? 0)) {
        gamesByAppId.set(appId, { appId, dropsRemaining });
      }
    }

    return {
      success: true,
      progress: result.status === 'SCANNING_CARD_DROPS',
      games: Array.from(gamesByAppId.values()).sort((left, right) => left.appId - right.appId),
      incomplete: result.incomplete === true,
      failedPages: parseNonNegativeInteger(result.failedPages),
      scannedPages: parseNonNegativeInteger(result.scannedPages),
      totalPages: parseNonNegativeInteger(result.totalPages)
    };
  }

  return null;
}

export function parseCardDropCountWorkerOutput(stdout, expectedSteamId, expectedAppId) {
  const steamId = String(expectedSteamId || '');
  const appId = parseAppId(expectedAppId);
  if (!/^7656\d{13}$/.test(steamId) || appId === null || typeof stdout !== 'string') return null;

  const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    let result;
    try {
      result = JSON.parse(line);
    } catch {
      continue;
    }

    if (result?.success === false) {
      const reason = FAILURE_REASONS.has(result.reason) ? result.reason : 'unavailable';
      return { success: false, reason };
    }
    if (result?.success !== true || result.steamId !== steamId || parseAppId(result.appId) !== appId) continue;

    const dropsRemaining = Number(result.dropsRemaining);
    if (!Number.isSafeInteger(dropsRemaining) || dropsRemaining < 0) return null;
    return { success: true, steamId, appId, dropsRemaining };
  }

  return null;
}
