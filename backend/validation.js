export const MAX_APP_ID = 0xFFFFFFFF;
export const MAX_IDLE_SESSIONS = 32;

const MAX_GAME_NAME_LENGTH = 120;

export function parseAppId(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (typeof normalized === 'string' && !/^\d+$/.test(normalized)) return null;

  const appId = Number(normalized);
  return Number.isSafeInteger(appId) && appId > 0 && appId <= MAX_APP_ID ? appId : null;
}

export function normalizeGameName(value, appId) {
  if (typeof value !== 'string') return `AppID ${appId}`;
  const name = value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, MAX_GAME_NAME_LENGTH);
  return name || `AppID ${appId}`;
}
