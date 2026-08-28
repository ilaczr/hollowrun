import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createSteamAvatarDescriptor,
  createSteamProfileImageDescriptor,
  extractProfileDecorationAssetPaths,
  extractProfileBackgroundAssetPath,
  extractProfileBackgroundAssetPathFromHtml,
  fetchPublicSteamProfileAvatar,
  fetchPublicSteamProfileBackground,
  getActiveSteamProfileDecorations,
  getActiveSteamProfileBackground,
  isAllowedSteamAvatarUrl,
  isAllowedSteamProfileBackgroundUrl,
  isAllowedSteamProfileBackgroundVideoUrl,
  getActiveSteamProfileBackgroundUrl,
  parsePublicSteamProfileAvatar,
  parsePublicSteamProfileBackground
} from './steam-profile.js';

const STEAM_ID = '76561198000000001';
const ACCOUNT_ID = '39734273';
const FIRST_ASSET = 'items/562260/6b71ae5b7c8a314d918e1610504eaf085571c2ce.jpg';
const SECOND_ASSET = 'items/753/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png';
const MINI_VIDEO = 'items/753/cccccccccccccccccccccccccccccccccccccccc.webm';
const FRAME_ASSET = 'items/730/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png';
const STATIC_FRAME_ASSET = 'items/730/dddddddddddddddddddddddddddddddddddddddd.png';
const PUBLIC_ASSET = 'items/617670/ba85462313fec5557c0d7c73393570a9d3d86bce.jpg';
const ANIMATED_POSTER = 'items/1328670/843cf3b9917330ee3afcb026f649f7f0effeb784.jpg';
const ANIMATED_VIDEO = 'items/1328670/f0fab5f5d6fa6bd08c4ae68fdf2ab4a977265aa3.webm';
const AVATAR_HASH = '06abb8fb6ad7a450ef67f90ac8a3b93c5dc4fb47';
const AVATAR_URL = `https://avatars.akamai.steamstatic.com/${AVATAR_HASH}_full.jpg`;

function makeVdfLine(steamId, profile) {
  return `"GetEquippedProfileItemsForUser${steamId}"  ${JSON.stringify(JSON.stringify(profile))}`;
}

function makePublicProfileHtml(steamId, assetPath = PUBLIC_ASSET) {
  return `
    <script>g_rgProfileData = {"url":"https://steamcommunity.com/id/example/","steamid":"${steamId}","personaname":"Example"};</script>
    ${assetPath ? `<div class="no_header profile_page has_profile_background"
      style="background-image: url( &#39;https://shared.fastly.steamstatic.com/community_assets/images/${assetPath}&#39; );">` : ''}
  `;
}

function makePublicProfileXml(steamId, avatarUrl = AVATAR_URL, personaName = 'Example') {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <profile>
      <steamID64>${steamId}</steamID64>
      <steamID><![CDATA[${personaName}]]></steamID>
      <avatarFull><![CDATA[${avatarUrl}]]></avatarFull>
    </profile>`;
}

test('extracts the active user profile background from CRLF VDF content', () => {
  const localConfig = [
    '"UserLocalConfigStore"',
    '{',
    makeVdfLine(STEAM_ID, {
      profile_background: { image_large: FIRST_ASSET },
      mini_profile_background: {
        image_large: SECOND_ASSET,
        movie_webm: MINI_VIDEO
      },
      avatar_frame: {
        image_large: STATIC_FRAME_ASSET,
        image_small: `images/${FRAME_ASSET}`
      }
    }),
    '}'
  ].join('\r\n');

  assert.equal(extractProfileBackgroundAssetPath(localConfig, STEAM_ID), FIRST_ASSET);
  assert.deepEqual(extractProfileDecorationAssetPaths(localConfig, STEAM_ID), {
    background: FIRST_ASSET,
    backgroundAnimation: null,
    miniBackground: SECOND_ASSET,
    miniBackgroundAnimation: MINI_VIDEO,
    avatarFrame: FRAME_ASSET
  });
});

test('requires the exact active-user key', () => {
  const otherUser = '76561198000000002';
  const localConfig = makeVdfLine(otherUser, {
    profile_background: { image_large: FIRST_ASSET }
  });
  assert.equal(extractProfileBackgroundAssetPath(localConfig, STEAM_ID), null);
});

test('rejects malformed and unsafe profile background data', () => {
  const invalidAssets = [
    '../secrets.jpg',
    'https://example.com/background.jpg',
    'items/730/short.jpg',
    'items/730/0123456789012345678901234567890123456789.exe'
  ];

  for (const imageLarge of invalidAssets) {
    const localConfig = makeVdfLine(STEAM_ID, {
      profile_background: { image_large: imageLarge }
    });
    assert.equal(extractProfileBackgroundAssetPath(localConfig, STEAM_ID), null);
  }

  assert.equal(
    extractProfileBackgroundAssetPath(
      `"GetEquippedProfileItemsForUser${STEAM_ID}" "{not valid JSON}"`,
      STEAM_ID
    ),
    null
  );
});

test('extracts only the selected full-profile background from public profile HTML', () => {
  const profileHtml = `${makePublicProfileHtml(STEAM_ID, null)}
    <img src="https://shared.fastly.steamstatic.com/community_assets/images/items/1000470/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg">
    <div class="no_header profile_page has_profile_background"
      style="background-image: url( &#39;https://shared.fastly.steamstatic.com/community_assets/images/${PUBLIC_ASSET}&#39; );">
  `;

  assert.equal(extractProfileBackgroundAssetPathFromHtml(profileHtml), PUBLIC_ASSET);
  assert.equal(
    extractProfileBackgroundAssetPathFromHtml(
      `<div class="profile_page has_profile_background" style="background-image:url('https://example.com/${PUBLIC_ASSET}')">`
    ),
    null
  );
});

test('uses the still poster for an animated full-profile background', () => {
  const profileHtml = `
    <script>g_rgProfileData = {"steamid":"${STEAM_ID}"};</script>
    <div class="no_header profile_page has_profile_background" style="">
      <div class="profile_animated_background">
        <video autoplay muted loop
          poster="https://shared.fastly.steamstatic.com/community_assets/images/${ANIMATED_POSTER}">
          <source src="https://shared.fastly.steamstatic.com/community_assets/images/${ANIMATED_VIDEO}" type="video/webm">
        </video>
      </div>
    </div>`;

  assert.equal(extractProfileBackgroundAssetPathFromHtml(profileHtml), ANIMATED_POSTER);
  assert.deepEqual(parsePublicSteamProfileBackground(profileHtml, STEAM_ID), {
    validProfile: true,
    background: {
      assetPath: ANIMATED_POSTER,
      remoteUrl: `https://shared.fastly.steamstatic.com/community_assets/images/${ANIMATED_POSTER}`,
      revision: '843cf3b9917330ee3afcb026f649f7f0effeb784',
      animation: {
        assetPath: ANIMATED_VIDEO,
        remoteUrl: `https://shared.fastly.steamstatic.com/community_assets/images/${ANIMATED_VIDEO}`,
        revision: 'f0fab5f5d6fa6bd08c4ae68fdf2ab4a977265aa3',
        contentType: 'video/webm'
      }
    }
  });
});

test('rejects an animated background poster outside Steam static assets', () => {
  const profileHtml = `
    <script>g_rgProfileData = {"steamid":"${STEAM_ID}"};</script>
    <div class="profile_page has_profile_background" style="">
      <div class="profile_animated_background">
        <video poster="https://example.com/${ANIMATED_POSTER}"></video>
      </div>
    </div>`;

  assert.deepEqual(parsePublicSteamProfileBackground(profileHtml, STEAM_ID), {
    validProfile: false,
    background: null
  });
});

test('validates public-profile identity and treats no background as authoritative', () => {
  assert.deepEqual(parsePublicSteamProfileBackground(makePublicProfileHtml(STEAM_ID), STEAM_ID), {
    validProfile: true,
    background: {
      assetPath: PUBLIC_ASSET,
      remoteUrl: `https://shared.fastly.steamstatic.com/community_assets/images/${PUBLIC_ASSET}`,
      revision: 'ba85462313fec5557c0d7c73393570a9d3d86bce'
    }
  });
  assert.deepEqual(parsePublicSteamProfileBackground(makePublicProfileHtml(STEAM_ID, null), STEAM_ID), {
    validProfile: true,
    background: null
  });
  assert.deepEqual(
    parsePublicSteamProfileBackground(makePublicProfileHtml('76561198000000002'), STEAM_ID),
    { validProfile: false, background: null }
  );
});

test('resolves the current public profile background through same-host redirects', async () => {
  const requestedUrls = [];
  const responses = [
    new Response(null, {
      status: 302,
      headers: { Location: 'https://steamcommunity.com/id/ju6697/?l=english' }
    }),
    new Response(
      makePublicProfileHtml(STEAM_ID),
      { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } }
    )
  ];

  const background = await fetchPublicSteamProfileBackground(STEAM_ID, {
    fetchImpl: async (url, options) => {
      requestedUrls.push({ url: String(url), redirect: options.redirect });
      return responses.shift();
    }
  });

  assert.deepEqual(background, {
    resolved: true,
    background: {
      assetPath: PUBLIC_ASSET,
      remoteUrl: `https://shared.fastly.steamstatic.com/community_assets/images/${PUBLIC_ASSET}`,
      revision: 'ba85462313fec5557c0d7c73393570a9d3d86bce'
    }
  });
  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls[0].redirect, 'manual');
  assert.match(requestedUrls[1].url, /^https:\/\/steamcommunity\.com\/id\/ju6697\//);
});

test('rejects public-profile redirects away from Steam Community', async () => {
  let requestCount = 0;
  const background = await fetchPublicSteamProfileBackground(STEAM_ID, {
    fetchImpl: async () => {
      requestCount += 1;
      return new Response(null, {
        status: 302,
        headers: { Location: 'http://127.0.0.1/private' }
      });
    }
  });

  assert.deepEqual(background, { resolved: false, background: null });
  assert.equal(requestCount, 1);
});

test('parses and validates the public full-size Steam avatar', () => {
  assert.deepEqual(parsePublicSteamProfileAvatar(makePublicProfileXml(STEAM_ID), STEAM_ID), {
    validProfile: true,
    avatar: {
      remoteUrl: AVATAR_URL,
      revision: AVATAR_HASH
    },
    personaName: 'Example'
  });
  assert.deepEqual(
    parsePublicSteamProfileAvatar(makePublicProfileXml('76561198000000002'), STEAM_ID),
    { validProfile: false, avatar: null, personaName: null }
  );
  assert.deepEqual(
    parsePublicSteamProfileAvatar(
      makePublicProfileXml(STEAM_ID, `https://example.com/${AVATAR_HASH}_full.jpg`),
      STEAM_ID
    ),
    { validProfile: false, avatar: null, personaName: null }
  );
  assert.equal(
    parsePublicSteamProfileAvatar(
      makePublicProfileXml(STEAM_ID, AVATAR_URL, ' Fresh\n Steam  Name '),
      STEAM_ID
    ).personaName,
    'Fresh Steam Name'
  );
  assert.deepEqual(createSteamAvatarDescriptor(AVATAR_URL), {
    remoteUrl: AVATAR_URL,
    revision: AVATAR_HASH
  });
  assert.equal(isAllowedSteamAvatarUrl(AVATAR_URL), true);
  assert.equal(isAllowedSteamAvatarUrl(`${AVATAR_URL}?stale=1`), false);
});

test('fetches the current public avatar without a key or local avatar cache', async () => {
  let requestedUrl;
  const result = await fetchPublicSteamProfileAvatar(STEAM_ID, {
    fetchImpl: async (url, options) => {
      requestedUrl = { url: String(url), options };
      return new Response(makePublicProfileXml(STEAM_ID), {
        status: 200,
        headers: { 'Content-Type': 'text/xml; charset=utf-8' }
      });
    }
  });

  assert.deepEqual(result, {
    resolved: true,
    avatar: {
      remoteUrl: AVATAR_URL,
      revision: AVATAR_HASH
    },
    personaName: 'Example'
  });
  const url = new URL(requestedUrl.url);
  assert.equal(url.origin, 'https://steamcommunity.com');
  assert.equal(url.pathname, `/profiles/${STEAM_ID}/`);
  assert.equal(url.searchParams.get('xml'), '1');
  assert.equal(Object.hasOwn(requestedUrl.options.headers, 'x-webapi-key'), false);
  assert.equal(requestedUrl.options.redirect, 'manual');
});

test('builds a revisioned descriptor only for the current Steam asset host', () => {
  assert.deepEqual(
    createSteamProfileImageDescriptor(
      `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/${FRAME_ASSET}`
    ),
    {
      assetPath: FRAME_ASSET,
      remoteUrl: `https://shared.fastly.steamstatic.com/community_assets/images/${FRAME_ASSET}`,
      revision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    }
  );
  assert.equal(createSteamProfileImageDescriptor('https://example.com/frame.png'), null);
  assert.equal(
    isAllowedSteamProfileBackgroundUrl(
      `https://shared.fastly.steamstatic.com/community_assets/images/${FIRST_ASSET}`
    ),
    true
  );
  assert.equal(
    isAllowedSteamProfileBackgroundUrl(
      `https://example.com/community_assets/images/${FIRST_ASSET}`
    ),
    false
  );
  assert.equal(
    isAllowedSteamProfileBackgroundVideoUrl(
      `https://shared.fastly.steamstatic.com/community_assets/images/${ANIMATED_VIDEO}`
    ),
    true
  );
  assert.equal(
    isAllowedSteamProfileBackgroundVideoUrl(
      `https://example.com/community_assets/images/${ANIMATED_VIDEO}`
    ),
    false
  );
});

test('reads and invalidates the cached active profile background safely', (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hollowrun-profile-'));
  context.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const configDirectory = path.join(tempRoot, 'userdata', ACCOUNT_ID, 'config');
  const localConfigPath = path.join(configDirectory, 'localconfig.vdf');
  fs.mkdirSync(configDirectory, { recursive: true });
  fs.writeFileSync(
    localConfigPath,
    makeVdfLine(STEAM_ID, { profile_background: { image_large: FIRST_ASSET } }),
    'utf8'
  );

  const activeUser = { steamId: STEAM_ID, accountId: ACCOUNT_ID };
  assert.deepEqual(
    getActiveSteamProfileDecorations(tempRoot, activeUser),
    {
      background: {
        assetPath: FIRST_ASSET,
        remoteUrl: `https://shared.fastly.steamstatic.com/community_assets/images/${FIRST_ASSET}`,
        revision: '6b71ae5b7c8a314d918e1610504eaf085571c2ce'
      },
      miniBackground: null,
      avatarFrame: null
    }
  );
  assert.deepEqual(
    getActiveSteamProfileBackground(tempRoot, activeUser),
    {
      assetPath: FIRST_ASSET,
      remoteUrl: `https://shared.fastly.steamstatic.com/community_assets/images/${FIRST_ASSET}`,
      revision: '6b71ae5b7c8a314d918e1610504eaf085571c2ce'
    }
  );
  assert.equal(
    getActiveSteamProfileBackgroundUrl(tempRoot, activeUser),
    `https://shared.fastly.steamstatic.com/community_assets/images/${FIRST_ASSET}`
  );

  fs.writeFileSync(
    localConfigPath,
    makeVdfLine(STEAM_ID, { profile_background: { image_large: SECOND_ASSET } }),
    'utf8'
  );
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(localConfigPath, future, future);

  assert.equal(
    getActiveSteamProfileBackgroundUrl(tempRoot, activeUser),
    `https://shared.fastly.steamstatic.com/community_assets/images/${SECOND_ASSET}`
  );
});
