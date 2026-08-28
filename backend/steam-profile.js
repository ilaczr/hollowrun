import fs from 'fs';
import path from 'path';

const PROFILE_BACKGROUND_BASE_URL =
  'https://shared.fastly.steamstatic.com/community_assets/images/';
const PROFILE_BACKGROUND_ASSET_PATTERN =
  /^items\/[1-9]\d*\/[a-f0-9]{40}\.(?:jpe?g|png|webp)$/i;
const PROFILE_BACKGROUND_VIDEO_ASSET_PATTERN =
  /^items\/[1-9]\d*\/[a-f0-9]{40}\.(?:webm|mp4)$/i;
const PROFILE_BACKGROUND_PATH_PREFIX = '/community_assets/images/';
const PUBLIC_PROFILE_MAX_BYTES = 1_500_000;
const PUBLIC_PROFILE_AVATAR_MAX_BYTES = 512_000;
const PUBLIC_PROFILE_TIMEOUT_MS = 6000;
const STEAM_AVATAR_HOSTS = new Set([
  'avatars.akamai.steamstatic.com',
  'avatars.cloudflare.steamstatic.com',
  'avatars.fastly.steamstatic.com'
]);
const profileBackgroundCache = new Map();

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSteamProfileAssetPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let candidate = value.trim().replace(/\\/g, '/');

  if (/^https:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate);
      if (url.username || url.password || url.search || url.hash) return null;
      const host = url.hostname.toLowerCase();
      if (host === 'shared.fastly.steamstatic.com') {
        const prefix = '/community_assets/images/';
        if (!url.pathname.startsWith(prefix)) return null;
        candidate = url.pathname.slice(prefix.length);
      } else if (
        host === 'cdn.cloudflare.steamstatic.com'
        || host === 'cdn.akamai.steamstatic.com'
      ) {
        const prefix = '/steamcommunity/public/images/';
        if (!url.pathname.startsWith(prefix)) return null;
        candidate = url.pathname.slice(prefix.length);
      } else {
        return null;
      }
    } catch {
      return null;
    }
  }

  candidate = candidate
    .replace(/^\/+/, '')
    .replace(/^community_assets\/images\//i, '')
    .replace(/^steamcommunity\/public\/images\//i, '')
    .replace(/^images\//i, '');
  return PROFILE_BACKGROUND_ASSET_PATTERN.test(candidate) ? candidate : null;
}

function normalizeSteamProfileVideoAssetPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let candidate = value.trim().replace(/\\/g, '/');

  if (/^https:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate);
      if (url.username || url.password || url.search || url.hash) return null;
      if (url.hostname.toLowerCase() !== 'shared.fastly.steamstatic.com') return null;
      if (!url.pathname.startsWith(PROFILE_BACKGROUND_PATH_PREFIX)) return null;
      candidate = url.pathname.slice(PROFILE_BACKGROUND_PATH_PREFIX.length);
    } catch {
      return null;
    }
  }

  candidate = candidate
    .replace(/^\/+/, '')
    .replace(/^community_assets\/images\//i, '')
    .replace(/^images\//i, '');
  return PROFILE_BACKGROUND_VIDEO_ASSET_PATTERN.test(candidate) ? candidate : null;
}

export function createSteamProfileImageDescriptor(value) {
  const assetPath = normalizeSteamProfileAssetPath(value);
  if (!assetPath) return null;
  const revision = assetPath.match(/\/([a-f0-9]{40})\.[^.]+$/i)?.[1]?.toLowerCase();
  const remoteUrl = `${PROFILE_BACKGROUND_BASE_URL}${assetPath}`;
  return revision && isAllowedSteamProfileBackgroundUrl(remoteUrl)
    ? Object.freeze({ assetPath, remoteUrl, revision })
    : null;
}

export function isAllowedSteamAvatarUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && STEAM_AVATAR_HOSTS.has(url.hostname.toLowerCase())
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && /^\/[a-f0-9]{40}_full\.jpg$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function createSteamAvatarDescriptor(value) {
  if (!isAllowedSteamAvatarUrl(value)) return null;
  const remoteUrl = new URL(value).toString();
  const revision = new URL(value).pathname.match(/^\/([a-f0-9]{40})_full\.jpg$/i)?.[1]
    ?.toLowerCase();
  return revision ? Object.freeze({ remoteUrl, revision }) : null;
}

export function createSteamProfileDecorationDescriptor(imageValue, videoValue = null) {
  const image = createSteamProfileImageDescriptor(imageValue);
  if (!image) return null;

  const videoAssetPath = normalizeSteamProfileVideoAssetPath(videoValue);
  if (!videoAssetPath || videoAssetPath.split('/')[1] !== image.assetPath.split('/')[1]) {
    return image;
  }

  const revision = videoAssetPath.match(/\/([a-f0-9]{40})\.[^.]+$/i)?.[1]?.toLowerCase();
  const remoteUrl = `${PROFILE_BACKGROUND_BASE_URL}${videoAssetPath}`;
  if (!revision || !isAllowedSteamProfileBackgroundVideoUrl(remoteUrl)) return image;

  return Object.freeze({
    ...image,
    animation: Object.freeze({
      assetPath: videoAssetPath,
      remoteUrl,
      revision,
      contentType: videoAssetPath.toLowerCase().endsWith('.webm')
        ? 'video/webm'
        : 'video/mp4'
    })
  });
}

function emptyProfileDecorationAssetPaths() {
  return {
    background: null,
    backgroundAnimation: null,
    miniBackground: null,
    miniBackgroundAnimation: null,
    avatarFrame: null
  };
}

export function extractProfileDecorationAssetPaths(localConfig, steamId) {
  if (typeof localConfig !== 'string' || !/^7656\d{13}$/.test(String(steamId || ''))) {
    return emptyProfileDecorationAssetPaths();
  }

  const cacheKey = `GetEquippedProfileItemsForUser${steamId}`;
  const linePattern = new RegExp(
    `^\\s*"${escapeRegExp(cacheKey)}"\\s+"((?:\\\\.|[^"\\\\])*)"\\s*$`,
    'm'
  );
  const match = localConfig.match(linePattern);
  if (!match) return emptyProfileDecorationAssetPaths();

  try {
    const serializedProfile = JSON.parse(`"${match[1]}"`);
    const profile = JSON.parse(serializedProfile);
    const profileBackground = profile?.profile_background;
    const miniProfileBackground = profile?.mini_profile_background;
    return {
      background: normalizeSteamProfileAssetPath(
        profileBackground?.image_large || profileBackground?.image_small
      ),
      backgroundAnimation: normalizeSteamProfileVideoAssetPath(
        profileBackground?.movie_webm
        || profileBackground?.movie_mp4
        || profileBackground?.item_movie_webm
        || profileBackground?.item_movie_mp4
      ),
      miniBackground: normalizeSteamProfileAssetPath(
        miniProfileBackground?.image_large
        || miniProfileBackground?.image_small
      ),
      miniBackgroundAnimation: normalizeSteamProfileVideoAssetPath(
        miniProfileBackground?.movie_webm_small
        || miniProfileBackground?.movie_webm
        || miniProfileBackground?.movie_mp4_small
        || miniProfileBackground?.movie_mp4
        || miniProfileBackground?.item_movie_webm_small
        || miniProfileBackground?.item_movie_webm
        || miniProfileBackground?.item_movie_mp4_small
        || miniProfileBackground?.item_movie_mp4
      ),
      avatarFrame: normalizeSteamProfileAssetPath(
        profile?.avatar_frame?.image_small
        || profile?.avatar_frame?.image_large
      )
    };
  } catch {
    return emptyProfileDecorationAssetPaths();
  }
}

export function extractProfileBackgroundAssetPath(localConfig, steamId) {
  return extractProfileDecorationAssetPaths(localConfig, steamId).background;
}

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:0*39|x0*27);/gi, "'")
    .replace(/&amp;/gi, '&');
}

function readHtmlAttribute(tag, attributeName) {
  const attributePattern = new RegExp(
    `\\b${escapeRegExp(attributeName)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'i'
  );
  const match = String(tag || '').match(attributePattern);
  return match ? decodeHtmlAttribute(match[1] ?? match[2] ?? '') : '';
}

function findAnimatedProfileBackground(profileHtml, wrapperEnd) {
  // Steam places the selected full-profile video immediately inside the
  // profile_page wrapper. Keep the scan bounded so unrelated videos (badges,
  // mini profiles, and showcases) can never be selected as the wallpaper.
  const backgroundWindow = profileHtml.slice(wrapperEnd, wrapperEnd + 16_384);

  for (const match of backgroundWindow.matchAll(/<div\b[^>]*>/gi)) {
    const openingTag = match[0];
    const classNames = readHtmlAttribute(openingTag, 'class').split(/\s+/).filter(Boolean);
    if (!classNames.includes('profile_animated_background')) continue;

    const videoWindow = backgroundWindow.slice(
      (match.index ?? 0) + openingTag.length,
      (match.index ?? 0) + openingTag.length + 4096
    );
    const videoTag = videoWindow.match(/<video\b[^>]*>/i)?.[0];
    const posterUrl = videoTag ? readHtmlAttribute(videoTag, 'poster') : '';
    if (!posterUrl || !isAllowedSteamProfileBackgroundUrl(posterUrl)) {
      return { found: true, valid: false, assetPath: null };
    }

    const url = new URL(posterUrl);
    const assetPath = url.pathname.slice(PROFILE_BACKGROUND_PATH_PREFIX.length);
    const posterAppId = assetPath.split('/')[1];
    let animation = null;

    for (const sourceMatch of videoWindow.matchAll(/<source\b[^>]*>/gi)) {
      const sourceUrl = readHtmlAttribute(sourceMatch[0], 'src');
      if (!sourceUrl || !isAllowedSteamProfileBackgroundVideoUrl(sourceUrl)) continue;

      const source = new URL(sourceUrl);
      const videoAssetPath = source.pathname.slice(PROFILE_BACKGROUND_PATH_PREFIX.length);
      if (videoAssetPath.split('/')[1] !== posterAppId) continue;

      const contentType = videoAssetPath.toLowerCase().endsWith('.webm')
        ? 'video/webm'
        : 'video/mp4';
      const candidate = { assetPath: videoAssetPath, contentType };
      if (!animation || contentType === 'video/webm') animation = candidate;
      if (contentType === 'video/webm') break;
    }

    return {
      found: true,
      valid: true,
      assetPath,
      animation
    };
  }

  return { found: false, valid: false, assetPath: null, animation: null };
}

function findProfileBackgroundInHtml(profileHtml) {
  if (typeof profileHtml !== 'string' || !profileHtml) {
    return { valid: false, assetPath: null };
  }

  for (const match of profileHtml.matchAll(/<div\b[^>]*>/gi)) {
    const openingTag = match[0];
    const classNames = readHtmlAttribute(openingTag, 'class').split(/\s+/).filter(Boolean);
    if (!classNames.includes('profile_page') || !classNames.includes('has_profile_background')) {
      continue;
    }

    const style = readHtmlAttribute(openingTag, 'style');
    const backgroundDeclaration = /background-image\s*:/i.test(style);
    if (backgroundDeclaration) {
      const imageMatch = style.match(
        /background-image\s*:\s*url\(\s*(['"]?)(https:\/\/[^'"\s)]+)\1\s*\)/i
      );
      if (!imageMatch || !isAllowedSteamProfileBackgroundUrl(imageMatch[2])) {
        return { valid: false, assetPath: null };
      }

      const url = new URL(imageMatch[2]);
      return {
        valid: true,
        assetPath: url.pathname.slice(PROFILE_BACKGROUND_PATH_PREFIX.length),
        animation: null
      };
    }

    const animatedBackground = findAnimatedProfileBackground(
      profileHtml,
      (match.index ?? 0) + openingTag.length
    );
    if (animatedBackground.found) {
      return {
        valid: animatedBackground.valid,
        assetPath: animatedBackground.assetPath,
        animation: animatedBackground.animation
      };
    }

    // The page claims a background exists but contains neither supported Steam
    // representation. Treat it as an unresolved response and preserve the
    // launch-time local fallback instead of incorrectly clearing the wallpaper.
    return { valid: false, assetPath: null };
  }

  return { valid: true, assetPath: null };
}

export function extractProfileBackgroundAssetPathFromHtml(profileHtml) {
  const result = findProfileBackgroundInHtml(profileHtml);
  return result.valid ? result.assetPath : null;
}

function createProfileBackgroundDescriptor(assetPath, animation = null) {
  return createSteamProfileDecorationDescriptor(assetPath, animation?.assetPath || animation);
}

export function parsePublicSteamProfileBackground(profileHtml, expectedSteamId) {
  const steamId = String(expectedSteamId || '');
  if (typeof profileHtml !== 'string' || !/^7656\d{13}$/.test(steamId)) {
    return { validProfile: false, background: null };
  }

  const profileDataOffset = profileHtml.indexOf('g_rgProfileData');
  if (profileDataOffset < 0) return { validProfile: false, background: null };

  const identityWindow = profileHtml.slice(profileDataOffset, profileDataOffset + 8192);
  const identityMatch = identityWindow.match(/["']steamid["']\s*:\s*["'](7656\d{13})["']/i);
  if (identityMatch?.[1] !== steamId) return { validProfile: false, background: null };

  const result = findProfileBackgroundInHtml(profileHtml);
  return result.valid
    ? {
        validProfile: true,
        background: createProfileBackgroundDescriptor(result.assetPath, result.animation)
      }
    : { validProfile: false, background: null };
}

export function parsePublicSteamProfileAvatar(profileXml, expectedSteamId) {
  const steamId = String(expectedSteamId || '');
  if (typeof profileXml !== 'string' || !/^7656\d{13}$/.test(steamId)) {
    return { validProfile: false, avatar: null, personaName: null };
  }

  const identityMatch = profileXml.match(
    /<steamID64>\s*(?:<!\[CDATA\[\s*)?(7656\d{13})(?:\s*\]\]>)?\s*<\/steamID64>/i
  );
  if (identityMatch?.[1] !== steamId) {
    return { validProfile: false, avatar: null, personaName: null };
  }

  const personaNameMatch = profileXml.match(
    /<steamID>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/steamID>/i
  );
  const personaName = String(personaNameMatch?.[1] || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);

  const avatarMatch = profileXml.match(/<avatarFull>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/avatarFull>/i);
  if (!avatarMatch || !personaName) {
    return { validProfile: false, avatar: null, personaName: null };
  }

  const avatarUrl = decodeHtmlAttribute(avatarMatch[1]).trim();
  const avatar = createSteamAvatarDescriptor(avatarUrl);
  return avatar
    ? { validProfile: true, avatar, personaName: decodeHtmlAttribute(personaName) }
    : { validProfile: false, avatar: null, personaName: null };
}

export function isAllowedSteamProfileBackgroundUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://shared.fastly.steamstatic.com'
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && /^\/community_assets\/images\/items\/[1-9]\d*\/[a-f0-9]{40}\.(?:jpe?g|png|webp)$/i
        .test(url.pathname);
  } catch {
    return false;
  }
}

export function isAllowedSteamProfileBackgroundVideoUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://shared.fastly.steamstatic.com'
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && /^\/community_assets\/images\/items\/[1-9]\d*\/[a-f0-9]{40}\.(?:webm|mp4)$/i
        .test(url.pathname);
  } catch {
    return false;
  }
}

function isAllowedSteamCommunityProfileUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'steamcommunity.com'
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

async function readBoundedTextResponse(response, maximumBytes) {
  const advertisedLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertisedLength) && advertisedLength > maximumBytes) {
    return null;
  }
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
  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

export async function fetchPublicSteamProfileBackground(
  steamId,
  {
    fetchImpl = globalThis.fetch,
    maximumBytes = PUBLIC_PROFILE_MAX_BYTES,
    timeoutMs = PUBLIC_PROFILE_TIMEOUT_MS,
    userAgent = 'HollowRun Desktop'
  } = {}
) {
  if (!/^7656\d{13}$/.test(String(steamId || '')) || typeof fetchImpl !== 'function') {
    return { resolved: false, background: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let currentUrl = new URL(`https://steamcommunity.com/profiles/${steamId}/?l=english`);

  try {
    for (let redirectCount = 0; redirectCount <= 2; redirectCount += 1) {
      const response = await fetchImpl(currentUrl, {
        redirect: 'manual',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.8',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'User-Agent': userAgent
        },
        signal: controller.signal
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || redirectCount === 2) return { resolved: false, background: null };
        const nextUrl = new URL(location, currentUrl);
        if (!isAllowedSteamCommunityProfileUrl(nextUrl)) {
          return { resolved: false, background: null };
        }
        try {
          await response.body?.cancel();
        } catch {}
        currentUrl = nextUrl;
        continue;
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!response.ok || !contentType.startsWith('text/html')) {
        return { resolved: false, background: null };
      }

      const profileHtml = await readBoundedTextResponse(response, maximumBytes);
      if (profileHtml === null) return { resolved: false, background: null };

      const parsed = parsePublicSteamProfileBackground(profileHtml, steamId);
      return parsed.validProfile
        ? { resolved: true, background: parsed.background }
        : { resolved: false, background: null };
    }
  } catch {
    return { resolved: false, background: null };
  } finally {
    clearTimeout(timeout);
  }

  return { resolved: false, background: null };
}

export async function fetchPublicSteamProfileAvatar(
  steamId,
  {
    fetchImpl = globalThis.fetch,
    maximumBytes = PUBLIC_PROFILE_AVATAR_MAX_BYTES,
    timeoutMs = PUBLIC_PROFILE_TIMEOUT_MS,
    userAgent = 'HollowRun Desktop'
  } = {}
) {
  if (!/^7656\d{13}$/.test(String(steamId || '')) || typeof fetchImpl !== 'function') {
    return { resolved: false, avatar: null, personaName: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let currentUrl = new URL(`https://steamcommunity.com/profiles/${steamId}/?xml=1`);

  try {
    for (let redirectCount = 0; redirectCount <= 2; redirectCount += 1) {
      const response = await fetchImpl(currentUrl, {
        redirect: 'manual',
        headers: {
          Accept: 'application/xml,text/xml;q=0.9',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'User-Agent': userAgent
        },
        signal: controller.signal
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || redirectCount === 2) return { resolved: false, avatar: null, personaName: null };
        const nextUrl = new URL(location, currentUrl);
        if (!isAllowedSteamCommunityProfileUrl(nextUrl)) {
          return { resolved: false, avatar: null, personaName: null };
        }
        try {
          await response.body?.cancel();
        } catch {}
        currentUrl = nextUrl;
        continue;
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (
        !response.ok
        || (!contentType.startsWith('text/xml') && !contentType.startsWith('application/xml'))
      ) {
        return { resolved: false, avatar: null, personaName: null };
      }

      const profileXml = await readBoundedTextResponse(response, maximumBytes);
      if (profileXml === null) return { resolved: false, avatar: null, personaName: null };

      const parsed = parsePublicSteamProfileAvatar(profileXml, steamId);
      return parsed.validProfile
        ? { resolved: true, avatar: parsed.avatar, personaName: parsed.personaName }
        : { resolved: false, avatar: null, personaName: null };
    }
  } catch {
    return { resolved: false, avatar: null, personaName: null };
  } finally {
    clearTimeout(timeout);
  }

  return { resolved: false, avatar: null, personaName: null };
}

export function getActiveSteamProfileDecorations(steamPath, activeUser) {
  const steamId = String(activeUser?.steamId || '');
  const accountId = String(activeUser?.accountId || '');
  if (
    typeof steamPath !== 'string'
    || !steamPath
    || !/^7656\d{13}$/.test(steamId)
    || !/^[1-9]\d*$/.test(accountId)
  ) {
    return null;
  }

  const localConfigPath = path.join(steamPath, 'userdata', accountId, 'config', 'localconfig.vdf');
  let stats;
  try {
    stats = fs.statSync(localConfigPath, { bigint: true });
    if (!stats.isFile()) return null;
  } catch {
    profileBackgroundCache.delete(steamId);
    return null;
  }

  const fingerprint = `${localConfigPath}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;
  const cached = profileBackgroundCache.get(steamId);
  if (cached?.fingerprint === fingerprint) return cached.decorations;

  let decorations = null;
  try {
    const localConfig = fs.readFileSync(localConfigPath, 'utf8');
    const assetPaths = extractProfileDecorationAssetPaths(localConfig, steamId);
    decorations = Object.freeze({
      background: createProfileBackgroundDescriptor(
        assetPaths.background,
        assetPaths.backgroundAnimation
      ),
      miniBackground: createSteamProfileDecorationDescriptor(
        assetPaths.miniBackground,
        assetPaths.miniBackgroundAnimation
      ),
      avatarFrame: createSteamProfileImageDescriptor(assetPaths.avatarFrame)
    });
  } catch {
    decorations = null;
  }

  profileBackgroundCache.set(steamId, { fingerprint, decorations });
  return decorations;
}

export function getActiveSteamProfileBackground(steamPath, activeUser) {
  return getActiveSteamProfileDecorations(steamPath, activeUser)?.background || null;
}

export function getActiveSteamProfileBackgroundUrl(steamPath, activeUser) {
  return getActiveSteamProfileBackground(steamPath, activeUser)?.remoteUrl || null;
}
