export const MAX_CUSTOM_PRESENCE_BYTES = 240;

export function normalizeCustomPresence(value) {
  if (typeof value !== 'string') return null;

  const normalized = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > MAX_CUSTOM_PRESENCE_BYTES) return null;
  return normalized;
}
