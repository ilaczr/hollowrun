import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { MAX_IDLE_SESSIONS, normalizeGameName, parseAppId } from './validation.js';
import {
  fetchPublicSteamProfileBackground,
  getActiveSteamProfileBackground,
  isAllowedSteamProfileBackgroundUrl,
  isAllowedSteamProfileBackgroundVideoUrl
} from './steam-profile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readAppVersion() {
  try {
    const rootPackage = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(rootPackage?.version)
      ? rootPackage.version
      : '0.0.0';
  } catch (error) {
    return '0.0.0';
  }
}

const APP_VERSION = readAppVersion();

const app = express();
const HOST = '127.0.0.1';
const PORT = 3824;
const BASE_URL = `http://${HOST}:${PORT}`;
const rawInstanceToken = process.env.HOLLOWRUN_INSTANCE_TOKEN || '';
const INSTANCE_TOKEN = /^[a-f0-9]{64}$/.test(rawInstanceToken) ? rawInstanceToken : null;
const IS_DESKTOP_RUNTIME = process.env.ELECTRON_APP === 'true';
if (!IS_DESKTOP_RUNTIME || !INSTANCE_TOKEN) {
  throw new Error('HollowRun backend can only be started by the authenticated desktop application.');
}
const ALLOWED_HOSTS = new Set([`${HOST}:${PORT}`]);
const ALLOWED_ORIGINS = new Set([
  BASE_URL
]);

app.disable('x-powered-by');

// The API controls local processes and reads local Steam metadata. Keep it
// accessible only through the local dashboard and reject DNS rebinding.
app.use((req, res, next) => {
  const host = req.get('host');
  const origin = req.get('origin');

  if (!ALLOWED_HOSTS.has(host)) {
    return res.status(403).json({ success: false, error: 'Invalid host' });
  }
  if (req.get('x-hollowrun-instance') !== INSTANCE_TOKEN) {
    return res.status(403).json({ success: false, error: 'Desktop authentication required' });
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ success: false, error: 'Invalid origin' });
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (INSTANCE_TOKEN) res.setHeader('X-HollowRun-Instance', INSTANCE_TOKEN);
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self'; img-src 'self' data: https://shared.fastly.steamstatic.com https://shared.akamai.steamstatic.com https://cdn.akamai.steamstatic.com https://store.cloudflare.steamstatic.com; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );
  next();
});

app.use(express.json({ limit: '32kb' }));

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'HollowRun/1.0' },
      signal: controller.signal
    });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Serve compiled static frontend from dist folder
const distPath = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// ===================================================================
// STEAM GAME INFO CACHE
// Fetches real game metadata from Steam Store API and caches to disk
// ===================================================================
const LEGACY_CACHE_FILE = path.join(__dirname, 'game_info_cache.json');
const CACHE_DIRECTORY = process.env.HOLLOWRUN_USER_DATA
  ? path.join(path.resolve(process.env.HOLLOWRUN_USER_DATA), 'cache')
  : __dirname;
const CACHE_FILE = path.join(CACHE_DIRECTORY, 'game-info.json');
const OWNERSHIP_CACHE_FILE = path.join(CACHE_DIRECTORY, 'owned-library.json');
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const GAME_INFO_CACHE_VERSION = 2;
const MAX_METADATA_REQUESTS = 6;
let gameInfoCache = {};
let ownershipCache = {};
let ownershipVerification = null;
let steamAppInfoCache = { signature: '', names: new Map(), scannedAppIds: new Set() };
let activeMetadataRequests = 0;
let cacheSaveTimer = null;
const metadataWaiters = [];
const gameInfoRequests = new Map();

function getDefaultHeaderImage(appId) {
  return `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
}

const PROFILE_WALLPAPER_MAX_BYTES = 12 * 1024 * 1024;
const PROFILE_WALLPAPER_ANIMATION_MAX_BYTES = 32 * 1024 * 1024;
const PROFILE_WALLPAPER_CACHE_MAX_BYTES = 36 * 1024 * 1024;
const PROFILE_WALLPAPER_CACHE_LIMIT = 3;
const PROFILE_WALLPAPER_TIMEOUT_MS = 8000;
const PROFILE_WALLPAPER_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PROFILE_WALLPAPER_VIDEO_CONTENT_TYPES = new Set(['video/webm', 'video/mp4']);
const profileWallpaperImageCache = new Map();
const profileWallpaperRequests = new Map();
let profileWallpaperCacheBytes = 0;
let launchProfileBackgroundState = null;

function getLaunchProfileBackground(steamPath, activeUser) {
  const steamId = String(activeUser?.steamId || '');
  if (!/^7656\d{13}$/.test(steamId)) return null;

  if (launchProfileBackgroundState?.steamId !== steamId) {
    const state = {
      steamId,
      background: getActiveSteamProfileBackground(steamPath, activeUser),
      request: null
    };
    launchProfileBackgroundState = state;
    state.request = fetchPublicSteamProfileBackground(steamId, {
      userAgent: `HollowRun/${APP_VERSION}`
    })
      .then(result => {
        if (launchProfileBackgroundState === state && result.resolved) {
          state.background = result.background;
        }
      })
      .catch(() => {});
  }

  return launchProfileBackgroundState.background;
}

function getCachedProfileWallpaper(cacheKey) {
  const cached = profileWallpaperImageCache.get(cacheKey);
  if (!cached) return null;
  profileWallpaperImageCache.delete(cacheKey);
  profileWallpaperImageCache.set(cacheKey, cached);
  return cached;
}

function cacheProfileWallpaper(cacheKey, image) {
  const previous = profileWallpaperImageCache.get(cacheKey);
  if (previous) profileWallpaperCacheBytes -= previous.data.length;
  profileWallpaperImageCache.delete(cacheKey);
  profileWallpaperImageCache.set(cacheKey, image);
  profileWallpaperCacheBytes += image.data.length;
  while (
    profileWallpaperImageCache.size > PROFILE_WALLPAPER_CACHE_LIMIT
    || profileWallpaperCacheBytes > PROFILE_WALLPAPER_CACHE_MAX_BYTES
  ) {
    const oldestKey = profileWallpaperImageCache.keys().next().value;
    const oldest = profileWallpaperImageCache.get(oldestKey);
    if (oldest) profileWallpaperCacheBytes -= oldest.data.length;
    profileWallpaperImageCache.delete(oldestKey);
  }
}

async function readBoundedResponseBody(response, maximumBytes) {
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
  return Buffer.concat(chunks, totalBytes);
}

async function downloadProfileWallpaper(background) {
  if (!background || !isAllowedSteamProfileBackgroundUrl(background.remoteUrl)) return null;

  const cacheKey = `image:${background.revision}:${background.assetPath}`;
  const cached = getCachedProfileWallpaper(cacheKey);
  if (cached) return cached;
  if (profileWallpaperRequests.has(cacheKey)) return profileWallpaperRequests.get(cacheKey);

  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROFILE_WALLPAPER_TIMEOUT_MS);
    try {
      const response = await fetch(background.remoteUrl, {
        redirect: 'error',
        headers: {
          Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5',
          'User-Agent': `HollowRun/${APP_VERSION}`
        },
        signal: controller.signal
      });
      if (!response.ok || !isAllowedSteamProfileBackgroundUrl(response.url)) return null;

      const contentType = String(response.headers.get('content-type') || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (!PROFILE_WALLPAPER_CONTENT_TYPES.has(contentType)) return null;

      const advertisedLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(advertisedLength) && advertisedLength > PROFILE_WALLPAPER_MAX_BYTES) {
        return null;
      }

      const data = await readBoundedResponseBody(response, PROFILE_WALLPAPER_MAX_BYTES);
      if (!data?.length) return null;

      const image = Object.freeze({ data, contentType });
      cacheProfileWallpaper(cacheKey, image);
      return image;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  })();

  profileWallpaperRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    profileWallpaperRequests.delete(cacheKey);
  }
}

async function downloadProfileWallpaperAnimation(animation) {
  if (!animation || !isAllowedSteamProfileBackgroundVideoUrl(animation.remoteUrl)) return null;

  const cacheKey = `animation:${animation.revision}:${animation.assetPath}`;
  const cached = getCachedProfileWallpaper(cacheKey);
  if (cached) return cached;
  if (profileWallpaperRequests.has(cacheKey)) return profileWallpaperRequests.get(cacheKey);

  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROFILE_WALLPAPER_TIMEOUT_MS);
    try {
      const response = await fetch(animation.remoteUrl, {
        redirect: 'error',
        headers: {
          Accept: 'video/webm,video/mp4;q=0.9,*/*;q=0.1',
          'User-Agent': `HollowRun/${APP_VERSION}`
        },
        signal: controller.signal
      });
      if (!response.ok || !isAllowedSteamProfileBackgroundVideoUrl(response.url)) return null;

      const contentType = String(response.headers.get('content-type') || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (
        !PROFILE_WALLPAPER_VIDEO_CONTENT_TYPES.has(contentType)
        || contentType !== animation.contentType
      ) {
        return null;
      }

      const advertisedLength = Number(response.headers.get('content-length'));
      if (
        Number.isFinite(advertisedLength)
        && advertisedLength > PROFILE_WALLPAPER_ANIMATION_MAX_BYTES
      ) {
        return null;
      }

      const data = await readBoundedResponseBody(response, PROFILE_WALLPAPER_ANIMATION_MAX_BYTES);
      if (!data?.length) return null;

      const video = Object.freeze({ data, contentType });
      cacheProfileWallpaper(cacheKey, video);
      return video;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  })();

  profileWallpaperRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    profileWallpaperRequests.delete(cacheKey);
  }
}

function sendBufferWithRange(req, res, asset) {
  const totalLength = asset.data.length;
  const requestedRange = String(req.get('range') || '').trim();
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', asset.contentType);

  if (!requestedRange) {
    res.setHeader('Content-Length', totalLength);
    res.send(asset.data);
    return;
  }

  const match = requestedRange.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2])) {
    res.setHeader('Content-Range', `bytes */${totalLength}`);
    res.status(416).end();
    return;
  }

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      res.setHeader('Content-Range', `bytes */${totalLength}`);
      res.status(416).end();
      return;
    }
    start = Math.max(0, totalLength - suffixLength);
    end = totalLength - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : totalLength - 1;
  }

  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || start >= totalLength
    || end < start
  ) {
    res.setHeader('Content-Range', `bytes */${totalLength}`);
    res.status(416).end();
    return;
  }

  end = Math.min(end, totalLength - 1);
  const chunk = asset.data.subarray(start, end + 1);
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${totalLength}`);
  res.setHeader('Content-Length', chunk.length);
  res.end(chunk);
}

function hasFreshGameInfo(info) {
  const cachedAt = Number(info?._cachedAt);
  return info?._cacheVersion === GAME_INFO_CACHE_VERSION
    && Number.isFinite(cachedAt)
    && (Date.now() - cachedAt) < CACHE_MAX_AGE_MS;
}

function loadCache() {
  gameInfoCache = {};
  for (const cacheFile of new Set([LEGACY_CACHE_FILE, CACHE_FILE])) {
    try {
      if (!fs.existsSync(cacheFile)) continue;
      const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        gameInfoCache = { ...gameInfoCache, ...parsed };
      }
    } catch (e) {}
  }

  try {
    if (fs.existsSync(OWNERSHIP_CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(OWNERSHIP_CACHE_FILE, 'utf8'));
      ownershipCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
  } catch (e) {
    ownershipCache = {};
  }
}

function saveCache() {
  try {
    fs.mkdirSync(CACHE_DIRECTORY, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(gameInfoCache, null, 2), 'utf8');
  } catch (e) {}
}

function saveOwnershipCache() {
  try {
    fs.mkdirSync(CACHE_DIRECTORY, { recursive: true });
    fs.writeFileSync(OWNERSHIP_CACHE_FILE, JSON.stringify(ownershipCache, null, 2), 'utf8');
  } catch (e) {}
}

function scheduleCacheSave() {
  if (cacheSaveTimer) clearTimeout(cacheSaveTimer);
  cacheSaveTimer = setTimeout(() => {
    cacheSaveTimer = null;
    saveCache();
  }, 250);
  cacheSaveTimer.unref?.();
}

loadCache();

function acquireMetadataSlot() {
  if (activeMetadataRequests < MAX_METADATA_REQUESTS) {
    activeMetadataRequests++;
    return Promise.resolve();
  }
  return new Promise(resolve => metadataWaiters.push(resolve));
}

function releaseMetadataSlot() {
  const next = metadataWaiters.shift();
  if (next) {
    next();
  } else {
    activeMetadataRequests--;
  }
}

// Fetch lightweight game details from Steam, globally bounded and deduplicated.
async function fetchSteamGameInfo(appId) {
  const cached = gameInfoCache[appId];
  if (hasFreshGameInfo(cached)) return cached;
  if (gameInfoRequests.has(appId)) return gameInfoRequests.get(appId);

  const request = (async () => {
    await acquireMetadataSlot();
    try {
      const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english&filters=basic`;
      const data = await fetchJson(url, 8000);
      if (!data) return gameInfoCache[appId] || cached || null;
      const entry = data[String(appId)];

      if (!entry || !entry.success || !entry.data) return gameInfoCache[appId] || cached || null;

      const d = entry.data;
      const previous = gameInfoCache[appId] || cached || {};
      const info = {
        ...previous,
        appid: appId,
        name: normalizeGameName(d.name, appId),
        type: d.type || previous.type || 'unknown',
        shortDescription: d.short_description || previous.shortDescription || '',
        developers: d.developers || previous.developers || [],
        publishers: d.publishers || previous.publishers || [],
        isFree: d.is_free ?? previous.isFree ?? false,
        headerImage: d.header_image || previous.headerImage || getDefaultHeaderImage(appId),
        capsuleImage: d.capsule_image || previous.capsuleImage || null,
        _cacheVersion: GAME_INFO_CACHE_VERSION,
        _cachedAt: Date.now()
      };

      gameInfoCache[appId] = info;
      scheduleCacheSave();
      return info;
    } catch (e) {
      return gameInfoCache[appId] || cached || null;
    } finally {
      releaseMetadataSlot();
    }
  })();

  gameInfoRequests.set(appId, request);
  try {
    return await request;
  } finally {
    if (gameInfoRequests.get(appId) === request) gameInfoRequests.delete(appId);
  }
}

// Fetch batches concurrently while the global limiter controls total Steam traffic.
async function batchFetchGameInfo(appIds) {
  const results = {};
  await Promise.all(appIds.map(async id => {
    const info = await fetchSteamGameInfo(id);
    if (info) results[id] = info;
  }));

  return results;
}

// ===================================================================
// PLAYTIME PARSER - localconfig.vdf
// ===================================================================
function parsePlaytimeData(steamPath, accountId) {
  const playtimeMap = new Map(); // appId -> { playtimeMinutes, lastPlayed }
  const normalizedAccountId = String(accountId || '');
  if (!steamPath || !/^\d+$/.test(normalizedAccountId)) return playtimeMap;

  const configPath = path.join(steamPath, 'userdata', normalizedAccountId, 'config', 'localconfig.vdf');
  if (!fs.existsSync(configPath)) return playtimeMap;

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const lines = content.split('\n');

    let currentAppId = null;
    let inAppsBlock = false;
    let braceDepth = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (line === '"apps"') {
        inAppsBlock = true;
        continue;
      }

      if (inAppsBlock && line === '{' && braceDepth === 0) {
        braceDepth = 1;
        continue;
      }

      if (!inAppsBlock || braceDepth < 1) continue;

      if (line === '{') {
        braceDepth++;
        continue;
      }
      if (line === '}') {
        braceDepth--;
        if (braceDepth === 1) currentAppId = null;
        if (braceDepth === 0) inAppsBlock = false;
        continue;
      }

      if (braceDepth === 1) {
        const idMatch = line.match(/^"(\d+)"$/);
        if (idMatch) {
          currentAppId = parseInt(idMatch[1], 10);
          if (!playtimeMap.has(currentAppId)) {
            playtimeMap.set(currentAppId, { playtimeMinutes: 0, lastPlayed: 0 });
          }
        }
      }

      if (braceDepth === 2 && currentAppId != null) {
        const kvMatch = line.match(/^"([^"]+)"\s+"([^"]+)"$/);
        if (!kvMatch) continue;

        const key = kvMatch[1];
        const value = kvMatch[2];
        const entry = playtimeMap.get(currentAppId);
        if (key === 'Playtime' || key === 'playtime') {
          entry.playtimeMinutes = parseInt(value, 10) || 0;
        } else if (key === 'PlaytimeDisconnected') {
          entry.playtimeMinutes += parseInt(value, 10) || 0;
        } else if (key === 'LastPlayed' || key === 'lastplayed') {
          entry.lastPlayed = parseInt(value, 10) || 0;
        }
      }
    }
  } catch (e) {}

  return playtimeMap;
}

function getCachedLibraryAppIds(steamPath, accountId) {
  const appIds = new Set();
  const normalizedAccountId = String(accountId || '');
  if (!steamPath || !/^\d+$/.test(normalizedAccountId)) return appIds;

  const cacheDir = path.join(steamPath, 'userdata', normalizedAccountId, 'config', 'librarycache');
  if (!fs.existsSync(cacheDir)) return appIds;

  try {
    for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
      const match = entry.name.match(/^(\d+)(?:\.|_|$)/i);
      if (!match) continue;
      const appId = parseInt(match[1], 10);
      if (appId > 10) appIds.add(appId);
    }
  } catch (e) {}

  return appIds;
}

const EXCLUDED_LIBRARY_APP_IDS = new Set([480, 228980]);

function isLibraryCandidate(appId) {
  return Number.isSafeInteger(appId) && appId > 10 && !EXCLUDED_LIBRARY_APP_IDS.has(appId);
}

function getSteamLibraryArtworkAppIds(steamPath) {
  const appIds = new Set();
  if (!steamPath) return appIds;
  const artworkDirectory = path.join(steamPath, 'appcache', 'librarycache');
  if (!fs.existsSync(artworkDirectory)) return appIds;

  try {
    for (const entry of fs.readdirSync(artworkDirectory, { withFileTypes: true })) {
      const match = entry.name.match(/^(\d+)(?:$|[_.])/);
      if (!match) continue;
      const appId = Number(match[1]);
      if (isLibraryCandidate(appId)) appIds.add(appId);
    }
  } catch (e) {}
  return appIds;
}

const STEAM_APPINFO_V28_MAGIC = 0x07564428;
const STEAM_APPINFO_V29_MAGIC = 0x07564429;
const STEAM_APPINFO_RECORD_HEADER_SIZE = 68;

function readNullTerminatedString(buffer, state, limit, wide = false) {
  const start = state.offset;
  let end = start;

  if (wide) {
    while (end + 1 < limit && (buffer[end] !== 0 || buffer[end + 1] !== 0)) end += 2;
    if (end + 1 >= limit) return null;
    state.offset = end + 2;
    return buffer.toString('utf16le', start, end);
  }

  end = buffer.indexOf(0, start);
  if (end < 0 || end >= limit) return null;
  state.offset = end + 1;
  return buffer.toString('utf8', start, end);
}

function readSteamAppInfoKey(buffer, state, limit, keyTable) {
  if (keyTable) {
    if (state.offset + 4 > limit) return null;
    const index = buffer.readInt32LE(state.offset);
    state.offset += 4;
    return index >= 0 && index < keyTable.length ? keyTable[index] : null;
  }
  return readNullTerminatedString(buffer, state, limit);
}

function findSteamAppNameInBinaryVdf(buffer, start, limit, keyTable, appId) {
  const state = { offset: start };
  const pathStack = [];

  while (state.offset < limit) {
    const valueType = buffer[state.offset++];
    if (valueType === 0x08 || valueType === 0x0b) {
      if (pathStack.length === 0) break;
      pathStack.pop();
      continue;
    }

    const key = readSteamAppInfoKey(buffer, state, limit, keyTable);
    if (key === null) return null;
    const normalizedKey = key.toLowerCase();

    if (valueType === 0x00) {
      pathStack.push(normalizedKey);
      continue;
    }

    let value = null;
    if (valueType === 0x01) {
      value = readNullTerminatedString(buffer, state, limit);
    } else if (valueType === 0x05) {
      value = readNullTerminatedString(buffer, state, limit, true);
    } else if ([0x02, 0x03, 0x04, 0x06].includes(valueType)) {
      state.offset += 4;
    } else if (valueType === 0x07 || valueType === 0x0a) {
      state.offset += 8;
    } else {
      return null;
    }

    if (state.offset > limit) return null;
    if ((valueType === 0x01 || valueType === 0x05) && value === null) return null;
    if (value === null) continue;
    if (
      pathStack.length >= 2
      && pathStack[0] === 'appinfo'
      && pathStack[pathStack.length - 1] === 'common'
      && normalizedKey === 'name'
    ) {
      const normalizedName = normalizeGameName(value, appId);
      return normalizedName === `AppID ${appId}` ? null : normalizedName;
    }
  }

  return null;
}

function readSteamAppInfoKeyTable(buffer, tableOffset) {
  if (!Number.isSafeInteger(tableOffset) || tableOffset < 16 || tableOffset + 4 > buffer.length) return null;
  const keyCount = buffer.readInt32LE(tableOffset);
  if (keyCount < 0 || keyCount > 1000000) return null;

  const keys = [];
  const state = { offset: tableOffset + 4 };
  for (let index = 0; index < keyCount; index++) {
    const key = readNullTerminatedString(buffer, state, buffer.length);
    if (key === null) return null;
    keys.push(key);
  }
  return keys;
}

function getSteamAppInfoNames(steamPath, requestedAppIds) {
  const requested = new Set([...requestedAppIds].filter(isLibraryCandidate));
  if (!steamPath || requested.size === 0) return new Map();

  const appInfoPath = path.join(steamPath, 'appcache', 'appinfo.vdf');
  try {
    const stats = fs.statSync(appInfoPath);
    const signature = `${stats.size}:${Math.trunc(stats.mtimeMs)}`;
    if (steamAppInfoCache.signature !== signature) {
      steamAppInfoCache = { signature, names: new Map(), scannedAppIds: new Set() };
    }

    const missingAppIds = new Set(
      [...requested].filter(appId => !steamAppInfoCache.scannedAppIds.has(appId))
    );
    if (missingAppIds.size === 0) return steamAppInfoCache.names;

    const buffer = fs.readFileSync(appInfoPath);
    if (buffer.length < 12) return steamAppInfoCache.names;

    const magic = buffer.readUInt32LE(0);
    const isV29 = magic === STEAM_APPINFO_V29_MAGIC;
    if (!isV29 && magic !== STEAM_APPINFO_V28_MAGIC) return steamAppInfoCache.names;

    const keyTableOffset = isV29 ? Number(buffer.readBigInt64LE(8)) : buffer.length;
    const keyTable = isV29 ? readSteamAppInfoKeyTable(buffer, keyTableOffset) : null;
    if (isV29 && !keyTable) return steamAppInfoCache.names;

    const recordsLimit = isV29 ? keyTableOffset : buffer.length;
    let offset = isV29 ? 16 : 8;
    while (offset + 8 <= recordsLimit && missingAppIds.size > 0) {
      const appId = buffer.readUInt32LE(offset);
      if (appId === 0) break;

      const entrySize = buffer.readUInt32LE(offset + 4);
      const recordEnd = offset + 8 + entrySize;
      if (entrySize < STEAM_APPINFO_RECORD_HEADER_SIZE - 8 || recordEnd > recordsLimit) break;

      if (missingAppIds.has(appId)) {
        const name = findSteamAppNameInBinaryVdf(
          buffer,
          offset + STEAM_APPINFO_RECORD_HEADER_SIZE,
          recordEnd,
          keyTable,
          appId
        );
        if (name) steamAppInfoCache.names.set(appId, name);
        steamAppInfoCache.scannedAppIds.add(appId);
        missingAppIds.delete(appId);
      }

      offset = recordEnd;
    }

    for (const appId of missingAppIds) steamAppInfoCache.scannedAppIds.add(appId);
  } catch (error) {
    // Store metadata remains available if Steam's local cache is unavailable.
  }

  return steamAppInfoCache.names;
}

// In-memory sessions store
const activeSessions = new Map();

// ===================================================================
// STEAM PATH & USER DETECTION
// ===================================================================
let cachedSteamPath = null;

function getSteamPath() {
  if (cachedSteamPath && fs.existsSync(cachedSteamPath)) return cachedSteamPath;
  cachedSteamPath = null;

  try {
    const output = execFileSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { encoding: 'utf8', windowsHide: true }
    );
    const match = output.match(/SteamPath\s+REG_\w+\s+(.+)$/im);
    const registryPath = match?.[1]?.trim();
    if (registryPath && fs.existsSync(registryPath)) {
      cachedSteamPath = path.normalize(registryPath);
      return cachedSteamPath;
    }
  } catch (e) {}

  const defaultPaths = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', 'D:\\Steam'];
  for (const p of defaultPaths) {
    if (fs.existsSync(p)) {
      cachedSteamPath = p;
      return cachedSteamPath;
    }
  }
  return null;
}

function getLocalSteamArtPath(steamPath, appId, kind) {
  if (!steamPath) return null;
  const artDirectory = path.join(steamPath, 'appcache', 'librarycache', String(appId));
  if (!fs.existsSync(artDirectory)) return null;

  try {
    const files = fs.readdirSync(artDirectory);
    const preferredFiles = kind === 'header'
      ? ['header.jpg', 'library_header.jpg', 'library_hero.jpg', 'library_600x900.jpg']
      : [];
    if (kind === 'icon') {
      const hashedIcon = files.find(file => /^[a-f0-9]{40}\.(?:jpg|png)$/i.test(file));
      if (hashedIcon) preferredFiles.push(hashedIcon);
      preferredFiles.push('icon.png', 'icon.jpg', 'logo.png');
    }

    for (const file of preferredFiles) {
      if (!files.includes(file)) continue;
      const candidate = path.join(artDirectory, file);
      if (fs.statSync(candidate).isFile()) return candidate;
    }
  } catch (e) {}
  return null;
}

function parseVdfKV(content) {
  const result = {};
  const regex = /"([^"]+)"\s+"([^"]+)"/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    result[match[1]] = match[2];
  }
  return result;
}

function steamId64ToAccountId(steamId) {
  try {
    const accountId = BigInt(steamId) - 76561197960265728n;
    return accountId > 0n ? accountId.toString() : null;
  } catch (e) {
    return null;
  }
}

function getRunningSteamAccountId() {
  try {
    const output = execFileSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Valve\\Steam\\ActiveProcess', '/v', 'ActiveUser'],
      { encoding: 'utf8', windowsHide: true }
    );
    const match = output.match(/ActiveUser\s+REG_DWORD\s+0x([a-f0-9]+)/i);
    if (!match) return null;
    const accountId = parseInt(match[1], 16);
    return Number.isSafeInteger(accountId) && accountId > 0 ? String(accountId) : null;
  } catch (e) {
    return null;
  }
}

function getActiveSteamUser(steamPath) {
  if (!steamPath) return null;
  const loginUsersFile = path.join(steamPath, 'config', 'loginusers.vdf');
  if (!fs.existsSync(loginUsersFile)) return null;

  try {
    const content = fs.readFileSync(loginUsersFile, 'utf8');
    const lines = content.split('\n');
    let currentUser = null;
    const users = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const idMatch = trimmed.match(/"(7656\d+)"/);
      if (idMatch) {
        currentUser = { steamId: idMatch[1] };
        users.push(currentUser);
      } else if (currentUser) {
        const kvMatch = trimmed.match(/"([^"]+)"\s+"([^"]+)"/);
        if (kvMatch) currentUser[kvMatch[1]] = kvMatch[2];
      }
    }

    const usersWithAccountIds = users
      .map(user => ({ ...user, accountId: steamId64ToAccountId(user.steamId) }))
      .filter(user => user.accountId);
    const runningAccountId = getRunningSteamAccountId();
    const active = usersWithAccountIds.find(user => user.accountId === runningAccountId)
      || usersWithAccountIds.find(user => user.MostRecent === '1')
      || usersWithAccountIds[0];
    if (active) {
      return {
        steamId: active.steamId,
        accountId: active.accountId,
        personaName: active.PersonaName || active.AccountName || 'Steam User',
        accountName: active.AccountName || '',
        mostRecent: active.MostRecent === '1'
      };
    }
  } catch (err) {}
  return null;
}

function getActiveSteamAvatarPath(steamPath, activeUser) {
  if (!steamPath || !/^7656\d{13}$/.test(String(activeUser?.steamId || ''))) return null;

  const avatarDirectory = path.join(steamPath, 'config', 'avatarcache');
  for (const extension of ['png', 'jpg', 'jpeg']) {
    const avatarPath = path.join(avatarDirectory, `${activeUser.steamId}.${extension}`);
    try {
      if (fs.statSync(avatarPath).isFile()) return avatarPath;
    } catch (error) {}
  }
  return null;
}

function getOwnershipFingerprint(steamPath, steamId, candidateIds) {
  const hash = createHash('sha256');
  hash.update(String(steamId));
  for (const appId of candidateIds) hash.update(`:${appId}`);

  try {
    const packageInfoPath = path.join(steamPath, 'appcache', 'packageinfo.vdf');
    const stats = fs.statSync(packageInfoPath);
    hash.update(`:${stats.size}:${Math.trunc(stats.mtimeMs)}`);
  } catch (e) {
    hash.update(':no-package-cache');
  }

  return hash.digest('hex');
}

function requestOwnedAppIdsFromWorker(candidateIds, expectedSteamId) {
  return new Promise(resolve => {
    const workerExe = getWorkerExecutablePath();
    if (!workerExe) return resolve(null);

    let child;
    try {
      child = spawn(workerExe, ['--verify-library'], {
        cwd: path.dirname(workerExe),
        env: { ...process.env, SteamAppId: '480', SteamGameId: '480' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (e) {
      return resolve(null);
    }

    let settled = false;
    let stdout = '';
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(null);
    }, 15000);

    child.stdout.on('data', data => {
      if (stdout.length < 2 * 1024 * 1024) stdout += data.toString();
    });
    child.stderr.on('data', () => {});
    child.on('error', () => finish(null));
    child.on('close', () => {
      const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).reverse();
      for (const line of lines) {
        try {
          const result = JSON.parse(line);
          if (!result?.success || result.steamId !== expectedSteamId || !Array.isArray(result.ownedAppIds)) continue;
          const candidates = new Set(candidateIds);
          const ownedAppIds = new Set(
            result.ownedAppIds
              .map(parseAppId)
              .filter(appId => appId !== null && candidates.has(appId) && isLibraryCandidate(appId))
          );
          return finish(ownedAppIds);
        } catch (e) {}
      }
      finish(null);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(candidateIds));
  });
}

async function getVerifiedOwnedAppIds(steamPath, activeUser, candidateAppIds) {
  const candidateIds = [...candidateAppIds].filter(isLibraryCandidate).sort((left, right) => left - right);
  if (candidateIds.length === 0) return new Set();

  const fingerprint = getOwnershipFingerprint(steamPath, activeUser.steamId, candidateIds);
  const cached = ownershipCache[activeUser.steamId];
  if (cached?.fingerprint === fingerprint && Array.isArray(cached.appIds)) {
    const candidates = new Set(candidateIds);
    return new Set(cached.appIds.map(parseAppId).filter(appId => appId !== null && candidates.has(appId)));
  }

  if (ownershipVerification?.fingerprint === fingerprint) {
    return ownershipVerification.promise;
  }

  const verificationPromise = (async () => {
    const verified = await requestOwnedAppIdsFromWorker(candidateIds, activeUser.steamId);
    if (!verified) {
      if (!Array.isArray(cached?.appIds)) return null;
      const candidates = new Set(candidateIds);
      return new Set(cached.appIds.map(parseAppId).filter(appId => appId !== null && candidates.has(appId)));
    }

    ownershipCache[activeUser.steamId] = {
      fingerprint,
      verifiedAt: Date.now(),
      appIds: [...verified]
    };
    saveOwnershipCache();
    return verified;
  })();
  ownershipVerification = { fingerprint, promise: verificationPromise };

  try {
    return await verificationPromise;
  } finally {
    if (ownershipVerification?.promise === verificationPromise) ownershipVerification = null;
  }
}

// ===================================================================
// LIBRARY SCANNER - Active-account ownership + install and playtime data
// ===================================================================
async function scanFullLibrary(steamPath) {
  if (!steamPath) return [];

  const activeUser = getActiveSteamUser(steamPath);
  if (!activeUser?.accountId || !activeUser?.steamId) return [];

  const playtimeMap = parsePlaytimeData(steamPath, activeUser.accountId);
  const accountCacheAppIds = getCachedLibraryAppIds(steamPath, activeUser.accountId);
  const installedManifests = new Map();

  // Installed manifests add candidates and supply exact local names and paths.
  const libraryPaths = [path.join(steamPath, 'steamapps')];
  const libFoldersFile = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  if (fs.existsSync(libFoldersFile)) {
    try {
      const content = fs.readFileSync(libFoldersFile, 'utf8');
      const matches = content.match(/"path"\s+"([^"]+)"/g);
      if (matches) {
        for (const m of matches) {
          const rawPath = m.replace(/"path"\s+"/, '').replace(/"$/, '').replace(/\\\\/g, '\\');
          const appsPath = path.join(rawPath, 'steamapps');
          if (fs.existsSync(appsPath) && !libraryPaths.includes(appsPath)) {
            libraryPaths.push(appsPath);
          }
        }
      }
    } catch (e) {}
  }

  for (const libPath of libraryPaths) {
    try {
      if (!fs.existsSync(libPath)) continue;
      for (const file of fs.readdirSync(libPath)) {
        if (file.startsWith('appmanifest_') && file.endsWith('.acf')) {
          try {
            const content = fs.readFileSync(path.join(libPath, file), 'utf8');
            const kv = parseVdfKV(content);
            if (kv.appid && kv.name) {
              const appId = parseInt(kv.appid, 10);
              if (isLibraryCandidate(appId) && kv.name !== 'Steamworks Common Redistributables') {
                installedManifests.set(appId, {
                  name: kv.name,
                  installdir: kv.installdir || '',
                  sizeBytes: parseInt(kv.SizeOnDisk || '0', 10)
                });
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  // Steam's artwork cache contains unplayed and uninstalled library entries.
  // It can include stale or other-account data, so every candidate is verified
  // against the currently signed-in account before it reaches the UI.
  const candidateAppIds = new Set([
    ...getSteamLibraryArtworkAppIds(steamPath),
    ...accountCacheAppIds,
    ...playtimeMap.keys(),
    ...installedManifests.keys()
  ]);
  if (candidateAppIds.size === 0) return [];

  const verifiedAppIds = await getVerifiedOwnedAppIds(steamPath, activeUser, candidateAppIds);
  // If the worker is unavailable, fail closed to the account-specific cache.
  // Play history and the global artwork cache are never ownership evidence.
  const ownedAppIds = verifiedAppIds ?? accountCacheAppIds;
  const localAppInfoNames = getSteamAppInfoNames(steamPath, ownedAppIds);
  const gamesMap = new Map();

  for (const appId of ownedAppIds) {
    if (!isLibraryCandidate(appId)) continue;
    const manifest = installedManifests.get(appId);
    const playtime = playtimeMap.get(appId) || { playtimeMinutes: 0, lastPlayed: 0 };
    const cachedInfo = gameInfoCache[appId];
    const localAppInfoName = localAppInfoNames.get(appId);
    const hasHistory = playtime.playtimeMinutes > 0 || playtime.lastPlayed > 0;

    gamesMap.set(appId, {
      appid: appId,
      name: manifest?.name || localAppInfoName || cachedInfo?.name || `Steam App ${appId}`,
      ...(manifest ? {
        installdir: manifest.installdir,
        sizeBytes: manifest.sizeBytes
      } : {}),
      installed: Boolean(manifest),
      source: manifest ? 'installed' : (hasHistory ? 'history' : 'library'),
      playtimeMinutes: playtime.playtimeMinutes,
      lastPlayed: playtime.lastPlayed,
      lastPlayedDate: playtime.lastPlayed > 0
        ? new Date(playtime.lastPlayed * 1000).toISOString()
        : null,
      headerImage: cachedInfo?.headerImage || getDefaultHeaderImage(appId),
      capsuleImage: cachedInfo?.capsuleImage || null,
      metadataReady: Boolean(manifest?.name || localAppInfoName || hasFreshGameInfo(cachedInfo))
    });
  }

  return Array.from(gamesMap.values());
}

// ===================================================================
// WORKER PROCESS MANAGEMENT
// ===================================================================
function getWorkerExecutablePath() {
  const possiblePaths = [
    path.join(__dirname, '..', 'HollowRun.Worker', 'publish', 'HollowRun.Worker.exe'),
    path.join(__dirname, '..', 'HollowRun.Worker', 'bin', 'Release', 'net10.0', 'win-x64', 'HollowRun.Worker.exe'),
    path.join(__dirname, '..', 'HollowRun.Worker', 'bin', 'Debug', 'net10.0', 'HollowRun.Worker.exe')
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function startIdleSession(appId, gameName = '') {
  return new Promise((resolve) => {
    if (activeSessions.has(appId)) {
      const existing = activeSessions.get(appId);
      return resolve({ success: true, message: 'Already idling', session: getSessionInfo(existing) });
    }
    if (activeSessions.size >= MAX_IDLE_SESSIONS) {
      return resolve({ success: false, error: `At most ${MAX_IDLE_SESSIONS} games can be idled at once.` });
    }

    const workerExe = getWorkerExecutablePath();
    if (!workerExe) {
      return resolve({ success: false, error: 'HollowRun worker files are missing. Rebuild HollowRun so the worker is published and packaged with the app.' });
    }

    const workerDir = path.join(__dirname, 'workers', `app_${appId}`);
    if (!fs.existsSync(workerDir)) fs.mkdirSync(workerDir, { recursive: true });

    const exeDir = path.dirname(workerExe);
    const workerExecutableName = path.basename(workerExe);
    const workerBaseName = path.basename(workerExe, path.extname(workerExe));
    const workerFiles = [
      workerExecutableName,
      `${workerBaseName}.dll`,
      `${workerBaseName}.deps.json`,
      `${workerBaseName}.runtimeconfig.json`,
      'Facepunch.Steamworks.Win64.dll',
      'steam_api64.dll'
    ];
    for (const f of workerFiles) {
      const src = path.join(exeDir, f);
      const dst = path.join(workerDir, f);
      if (fs.existsSync(src)) {
        try { fs.copyFileSync(src, dst); } catch (e) {}
      }
    }

    let child;
    try {
      child = spawn(path.join(workerDir, workerExecutableName), [appId.toString()], {
        cwd: workerDir,
        env: { ...process.env, SteamAppId: appId.toString(), SteamGameId: appId.toString() },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (err) {
      return resolve({ success: false, error: `Failed to spawn process: ${err.message}` });
    }

    const sessionData = {
      appId, gameName: normalizeGameName(gameName, appId), process: child,
      startTime: Date.now(), personaName: '', steamId: '', status: 'STARTING', workerDir
    };
    activeSessions.set(appId, sessionData);

    let resolved = false;
    let stdoutBuffer = '';
    const finishStart = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(startupTimeout);
      resolve(result);
    };
    const startupTimeout = setTimeout(() => {
      stopIdleSession(appId);
      finishStart({ success: false, error: 'Steam worker timed out while starting.' });
    }, 15000);

    const processWorkerMessage = (line) => {
      if (!line) return;
      try {
        const json = JSON.parse(line);
        if (json.status === 'IDLING' && json.success) {
          sessionData.status = 'IDLING';
          sessionData.personaName = typeof json.personaName === 'string' ? json.personaName.slice(0, 100) : '';
          sessionData.steamId = typeof json.steamId === 'string' ? json.steamId.slice(0, 32) : '';
          finishStart({ success: true, session: getSessionInfo(sessionData) });
        } else if (json.success === false) {
          stopIdleSession(appId);
          finishStart({ success: false, error: json.error || 'Failed to initialize' });
        }
      } catch (e) {
        // Ignore non-JSON diagnostics from the worker.
      }
    };

    child.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      let newlineIndex;
      while ((newlineIndex = stdoutBuffer.indexOf('\n')) >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        processWorkerMessage(line);
      }
    });

    child.stderr.on('data', (data) => console.error(`[Worker ${appId}]:`, data.toString().slice(0, 2000)));
    child.once('error', (err) => {
      activeSessions.delete(appId);
      finishStart({ success: false, error: `Worker process error: ${err.message}` });
    });
    child.on('exit', (code) => {
      processWorkerMessage(stdoutBuffer.trim());
      activeSessions.delete(appId);
      finishStart({ success: false, error: `Worker exited with code ${code}` });
    });
  });
}

function stopIdleSession(appId) {
  if (!activeSessions.has(appId)) return { success: false, message: 'Not running' };
  const session = activeSessions.get(appId);
  try {
    if (session.process && session.process.exitCode === null) {
      session.process.kill('SIGINT');
      setTimeout(() => {
        try {
          if (session.process.exitCode === null) session.process.kill('SIGKILL');
        } catch (e) {}
      }, 1000);
    }
  } catch (e) {}
  activeSessions.delete(appId);
  return { success: true, appId };
}

function getSessionInfo(session) {
  return {
    appId: session.appId, gameName: session.gameName, status: session.status,
    startTime: new Date(session.startTime).toISOString(),
    elapsedSeconds: Math.floor((Date.now() - session.startTime) / 1000),
    personaName: session.personaName, steamId: session.steamId,
    headerImage: gameInfoCache[session.appId]?.headerImage || getDefaultHeaderImage(session.appId)
  };
}

// ===================================================================
// API ENDPOINTS
// ===================================================================

app.get('/api/health', (req, res) => {
  res.json({ success: true, appVersion: APP_VERSION });
});

// Status
app.get('/api/status', (req, res) => {
  const steamPath = getSteamPath();
  const activeUser = getActiveSteamUser(steamPath);
  const avatarPath = getActiveSteamAvatarPath(steamPath, activeUser);
  const profileBackground = getLaunchProfileBackground(steamPath, activeUser);
  const profileWallpaperUrl = activeUser && profileBackground
    ? `/api/steam-profile-background/${activeUser.steamId}?v=${profileBackground.revision}`
    : null;
  const profileWallpaperVideoUrl = activeUser && profileBackground?.animation
    ? `/api/steam-profile-background/${activeUser.steamId}/animation?v=${profileBackground.animation.revision}`
    : null;
  res.json({
    success: true,
    appVersion: APP_VERSION,
    steamInstalled: !!steamPath,
    maxIdleSessions: MAX_IDLE_SESSIONS,
    activeUser: activeUser
      ? {
          personaName: activeUser.personaName,
          steamId: activeUser.steamId,
          avatarUrl: avatarPath ? `/api/steam-avatar/${activeUser.steamId}` : null,
          profileWallpaperUrl,
          profileWallpaperVideoUrl,
          profileWallpaperVideoType: profileBackground?.animation?.contentType || null
        }
      : {
          personaName: 'Steam Client',
          steamId: 'N/A',
          avatarUrl: null,
          profileWallpaperUrl: null,
          profileWallpaperVideoUrl: null,
          profileWallpaperVideoType: null
        },
    activeSessionsCount: activeSessions.size
  });
});

// The avatar cache is account-specific. Only expose the currently active user.
app.get('/api/steam-avatar/:steamid', (req, res) => {
  const steamPath = getSteamPath();
  const activeUser = getActiveSteamUser(steamPath);
  if (!activeUser || req.params.steamid !== activeUser.steamId) return res.status(404).end();

  const avatarPath = getActiveSteamAvatarPath(steamPath, activeUser);
  if (!avatarPath) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(avatarPath);
});

// Proxy only the active account's equipped profile background. It is resolved
// once per desktop launch from the public profile, with Steam's local cache as
// an offline fallback, then served through a revisioned same-origin URL.
app.get('/api/steam-profile-background/:steamid', async (req, res) => {
  const steamPath = getSteamPath();
  const activeUser = getActiveSteamUser(steamPath);
  if (!activeUser || req.params.steamid !== activeUser.steamId) return res.status(404).end();

  const background = getLaunchProfileBackground(steamPath, activeUser);
  if (!background) return res.status(404).end();

  const canonicalUrl = `/api/steam-profile-background/${activeUser.steamId}?v=${background.revision}`;
  if (req.query.v !== background.revision) return res.redirect(307, canonicalUrl);

  const etag = `"${background.revision}"`;
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
  res.setHeader('ETag', etag);
  if (req.get('if-none-match') === etag) return res.status(304).end();

  const image = await downloadProfileWallpaper(background);
  if (!image) return res.status(502).end();

  res.setHeader('Content-Type', image.contentType);
  res.setHeader('Content-Length', image.data.length);
  res.setHeader('Content-Disposition', 'inline');
  res.send(image.data);
});

app.get('/api/steam-profile-background/:steamid/animation', async (req, res) => {
  const steamPath = getSteamPath();
  const activeUser = getActiveSteamUser(steamPath);
  if (!activeUser || req.params.steamid !== activeUser.steamId) return res.status(404).end();

  const background = getLaunchProfileBackground(steamPath, activeUser);
  const animation = background?.animation;
  if (!animation) return res.status(404).end();

  const canonicalUrl = `/api/steam-profile-background/${activeUser.steamId}/animation?v=${animation.revision}`;
  if (req.query.v !== animation.revision) return res.redirect(307, canonicalUrl);

  const etag = `"animation-${animation.revision}"`;
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
  res.setHeader('ETag', etag);
  if (!req.get('range') && req.get('if-none-match') === etag) return res.status(304).end();

  const video = await downloadProfileWallpaperAnimation(animation);
  if (!video) return res.status(502).end();

  res.setHeader('Content-Disposition', 'inline');
  sendBufferWithRange(req, res, video);
});

// Serve only known Steam artwork filenames from the numeric AppID directory.
app.get('/api/steam-art/:appid/:kind', (req, res) => {
  const appId = parseAppId(req.params.appid);
  const kind = req.params.kind;
  if (appId === null || (kind !== 'header' && kind !== 'icon')) {
    return res.status(400).end();
  }

  const artPath = getLocalSteamArtPath(getSteamPath(), appId, kind);
  if (!artPath) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(artPath);
});

// Full active-account library with playtime data
app.get('/api/games', async (req, res) => {
  try {
    const steamPath = getSteamPath();
    const libraryGames = await scanFullLibrary(steamPath);

    const totalPlaytime = libraryGames.reduce((sum, game) => sum + (game.playtimeMinutes || 0), 0);
    const installedCount = libraryGames.filter(game => game.installed).length;
    const historyCount = libraryGames.filter(game => game.source === 'history').length;

    res.json({
      success: true,
      installed: libraryGames,
      libraryStats: {
        totalGames: libraryGames.length,
        installedGames: installedCount,
        historyGames: historyCount,
        totalPlaytimeMinutes: totalPlaytime,
        totalPlaytimeHours: +(totalPlaytime / 60).toFixed(1)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Could not verify the active Steam library.' });
  }
});

// Fetch detailed Steam info for a specific game
app.get('/api/game-info/:appid', async (req, res) => {
  const appId = parseAppId(req.params.appid);
  if (appId === null) return res.status(400).json({ success: false, error: 'Invalid AppID' });

  const info = await fetchSteamGameInfo(appId);
  if (!info) return res.json({ success: false, error: 'Could not fetch game info from Steam' });
  res.json({ success: true, gameInfo: info });
});

// Batch enrich multiple games with Steam metadata
app.post('/api/enrich-games', async (req, res) => {
  const { appids } = req.body ?? {};
  if (!Array.isArray(appids) || appids.length === 0) {
    return res.status(400).json({ success: false, error: 'Provide an array of appids' });
  }

  // A page plus its immediate neighbours fits comfortably in one bounded batch.
  const limited = [...new Set(appids.slice(0, 64).map(parseAppId).filter(id => id !== null))];
  if (limited.length === 0) {
    return res.status(400).json({ success: false, error: 'No valid AppIDs provided' });
  }
  const enriched = await batchFetchGameInfo(limited);
  const compactGames = {};
  for (const [appId, info] of Object.entries(enriched)) {
    compactGames[appId] = {
      appid: info.appid,
      name: info.name,
      headerImage: info.headerImage || getDefaultHeaderImage(appId),
      capsuleImage: info.capsuleImage || null,
      metadataReady: hasFreshGameInfo(info)
    };
  }
  res.json({ success: true, games: compactGames });
});

// Steam Store live search
app.get('/api/search-steam-store', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (query.length < 2) return res.json({ success: true, results: [] });

  try {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`;
    const data = await fetchJson(url);
    if (!data) return res.status(502).json({ success: false, error: 'Steam Store API error' });
    const results = (Array.isArray(data.items) ? data.items : [])
      .slice(0, 50)
      .map(item => {
        const appId = parseAppId(item?.id);
        if (appId === null) return null;
        const finalPrice = Number(item?.price?.final);
        return {
          appid: appId,
          name: normalizeGameName(item?.name, appId),
          headerImage: getDefaultHeaderImage(appId),
          price: Number.isFinite(finalPrice) ? (finalPrice / 100).toFixed(2) : 'Free',
          category: 'Steam Store Search'
        };
      })
      .filter(Boolean);
    res.json({ success: true, results });
  } catch (err) {
    res.status(502).json({ success: false, error: 'Steam Store request failed' });
  }
});

// Sessions
app.get('/api/sessions', (req, res) => {
  res.json({ success: true, sessions: Array.from(activeSessions.values()).map(getSessionInfo) });
});

// Start Idle
app.post('/api/idle/start', async (req, res) => {
  const { appid, appids, name } = req.body ?? {};
  if (appids !== undefined && !Array.isArray(appids)) {
    return res.status(400).json({ success: false, error: 'appids must be an array' });
  }

  const requestedIds = Array.isArray(appids) ? appids : (appid !== undefined ? [appid] : []);
  if (requestedIds.length === 0) return res.status(400).json({ success: false, error: 'No AppID specified' });
  if (requestedIds.length > MAX_IDLE_SESSIONS) {
    return res.status(400).json({ success: false, error: `At most ${MAX_IDLE_SESSIONS} AppIDs can be started at once` });
  }

  const targetIds = [...new Set(requestedIds.map(parseAppId))];
  if (targetIds.includes(null)) {
    return res.status(400).json({ success: false, error: 'One or more AppIDs are invalid' });
  }

  const results = [];
  for (const appId of targetIds) {
    results.push({ appid: appId, ...(await startIdleSession(appId, name)) });
  }
  res.json({ success: true, results });
});

// Stop Idle
app.post('/api/idle/stop', (req, res) => {
  const appId = parseAppId(req.body?.appid);
  if (appId === null) return res.status(400).json({ success: false, error: 'Valid AppID required' });
  res.json(stopIdleSession(appId));
});

// Stop All
app.post('/api/idle/stop-all', (req, res) => {
  const stopped = [];
  for (const appId of Array.from(activeSessions.keys())) { stopIdleSession(appId); stopped.push(appId); }
  res.json({ success: true, stoppedCount: stopped.length, stoppedAppIds: stopped });
});

// SPA fallback
app.get('*', (req, res) => {
  if (fs.existsSync(path.join(distPath, 'index.html'))) {
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    res.status(503).send('HollowRun backend is running, but the frontend build was not found.');
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`HollowRun server running at ${BASE_URL}`);
});

function shutdown() {
  if (cacheSaveTimer) {
    clearTimeout(cacheSaveTimer);
    cacheSaveTimer = null;
    saveCache();
  }
  for (const appId of Array.from(activeSessions.keys())) stopIdleSession(appId);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2000).unref();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
