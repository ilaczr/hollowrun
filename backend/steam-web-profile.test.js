import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchSteamProfileItemsEquipped,
  parseSteamProfileItemsEquipped
} from './steam-web-profile.js';

const STEAM_ID = '76561198000000001';
const BACKGROUND = 'items/753/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg';
const BACKGROUND_VIDEO = 'items/753/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webm';
const MINI_BACKGROUND = 'items/570/cccccccccccccccccccccccccccccccccccccccc.png';
const MINI_BACKGROUND_VIDEO = 'items/570/dddddddddddddddddddddddddddddddddddddddd.webm';
const AVATAR_FRAME = 'items/730/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png';
const STATIC_AVATAR_FRAME = 'items/730/ffffffffffffffffffffffffffffffffffffffff.png';

function makePayload() {
  return {
    response: {
      profile_background: {
        image_large: BACKGROUND,
        movie_webm: BACKGROUND_VIDEO
      },
      mini_profile_background: {
        image_large: MINI_BACKGROUND,
        movie_webm_small: MINI_BACKGROUND_VIDEO
      },
      avatar_frame: {
        image_large: STATIC_AVATAR_FRAME,
        image_small: AVATAR_FRAME
      }
    }
  };
}

test('parses animated full and mini profile items', () => {
  const decorations = parseSteamProfileItemsEquipped(makePayload());
  assert.equal(decorations.background.assetPath, BACKGROUND);
  assert.equal(decorations.background.animation.assetPath, BACKGROUND_VIDEO);
  assert.equal(decorations.background.animation.contentType, 'video/webm');
  assert.equal(decorations.miniBackground.assetPath, MINI_BACKGROUND);
  assert.equal(decorations.miniBackground.animation.assetPath, MINI_BACKGROUND_VIDEO);
  assert.equal(decorations.avatarFrame.assetPath, AVATAR_FRAME);
  assert.equal(parseSteamProfileItemsEquipped({}), null);
});

test('uses the public official Steam endpoint without credentials', async () => {
  let request;
  const result = await fetchSteamProfileItemsEquipped(STEAM_ID, {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify(makePayload()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  assert.equal(result.resolved, true);
  const requestedUrl = new URL(request.url);
  assert.equal(requestedUrl.origin, 'https://api.steampowered.com');
  assert.equal(requestedUrl.pathname, '/IPlayerService/GetProfileItemsEquipped/v1/');
  assert.equal(requestedUrl.searchParams.get('steamid'), STEAM_ID);
  assert.equal(requestedUrl.searchParams.has('key'), false);
  assert.equal(Object.hasOwn(request.options.headers, 'x-webapi-key'), false);
});

test('rejects invalid SteamIDs and oversized responses', async () => {
  assert.deepEqual(
    await fetchSteamProfileItemsEquipped('invalid'),
    { resolved: false, decorations: null }
  );

  const oversized = await fetchSteamProfileItemsEquipped(STEAM_ID, {
    maximumBytes: 8,
    fetchImpl: async () => new Response(JSON.stringify(makePayload()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  });
  assert.deepEqual(oversized, { resolved: false, decorations: null });
});
