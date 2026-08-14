import {
  createSteamProfileDecorationDescriptor,
  createSteamProfileImageDescriptor
} from './steam-profile.js';

const STEAM_PROFILE_ITEMS_URL =
  'https://api.steampowered.com/IPlayerService/GetProfileItemsEquipped/v1/';
const STEAM_PROFILE_RESPONSE_MAX_BYTES = 256 * 1024;
const STEAM_PROFILE_TIMEOUT_MS = 8000;

function isValidSteamId(value) {
  return /^7656\d{13}$/.test(String(value || ''));
}

function firstString(...values) {
  return values.find(value => typeof value === 'string' && value.trim()) || null;
}

function createDecoration(item, { preferSmallMovie = false } = {}) {
  if (!item || typeof item !== 'object') return null;
  const movie = preferSmallMovie
    ? firstString(
        item.movie_webm_small,
        item.movie_webm,
        item.movie_mp4_small,
        item.movie_mp4,
        item.item_movie_webm_small,
        item.item_movie_webm,
        item.item_movie_mp4_small,
        item.item_movie_mp4
      )
    : firstString(
        item.movie_webm,
        item.movie_mp4,
        item.item_movie_webm,
        item.item_movie_mp4
      );
  return createSteamProfileDecorationDescriptor(
    firstString(item.image_large, item.image_small, item.item_image_large, item.item_image_small),
    movie
  );
}

export function parseSteamProfileItemsEquipped(payload) {
  const profile = payload?.response;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;

  return Object.freeze({
    background: createDecoration(profile.profile_background),
    miniBackground: createDecoration(profile.mini_profile_background, { preferSmallMovie: true }),
    avatarFrame: createSteamProfileImageDescriptor(firstString(
      profile.avatar_frame?.image_small,
      profile.avatar_frame?.image_large,
      profile.avatar_frame?.item_image_small,
      profile.avatar_frame?.item_image_large
    ))
  });
}

async function readBoundedJson(response, maximumBytes) {
  const advertisedLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertisedLength) && advertisedLength > maximumBytes) return null;
  if (!response.body) return null;

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maximumBytes) {
      try {
        await response.body.cancel();
      } catch {}
      return null;
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks, totalBytes).toString('utf8'));
  } catch {
    return null;
  }
}

export async function fetchSteamProfileItemsEquipped(
  steamId,
  {
    fetchImpl = globalThis.fetch,
    maximumBytes = STEAM_PROFILE_RESPONSE_MAX_BYTES,
    timeoutMs = STEAM_PROFILE_TIMEOUT_MS,
    userAgent = 'HollowRun Desktop'
  } = {}
) {
  if (
    !isValidSteamId(steamId)
    || typeof fetchImpl !== 'function'
  ) {
    return { resolved: false, decorations: null };
  }

  const url = new URL(STEAM_PROFILE_ITEMS_URL);
  url.searchParams.set('steamid', String(steamId));
  url.searchParams.set('language', 'english');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), {
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent
      },
      signal: controller.signal
    });
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!response.ok || !contentType.startsWith('application/json')) {
      return { resolved: false, decorations: null };
    }

    const payload = await readBoundedJson(response, maximumBytes);
    const decorations = parseSteamProfileItemsEquipped(payload);
    return decorations
      ? { resolved: true, decorations }
      : { resolved: false, decorations: null };
  } catch {
    return { resolved: false, decorations: null };
  } finally {
    clearTimeout(timeout);
  }
}
