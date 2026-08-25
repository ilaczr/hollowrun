export function normalizeCardDropGames(games) {
  const seen = new Set();
  return (Array.isArray(games) ? games : []).flatMap(game => {
    const appId = Number(game?.appId);
    if (!Number.isSafeInteger(appId) || appId <= 10 || appId === 480 || seen.has(appId)) return [];
    seen.add(appId);
    const dropsRemaining = Number(game?.dropsRemaining);
    return [{
      appId,
      dropsRemaining: Number.isSafeInteger(dropsRemaining) && dropsRemaining > 0
        ? dropsRemaining
        : null
    }];
  });
}

export function formatTimer(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function formatPlaytime(minutes) {
  if (!minutes || minutes === 0) return null;
  if (minutes < 60) return `${minutes}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

export function formatDropsLeft(value) {
  return Number.isSafeInteger(value) && value > 0
    ? `${value} drop${value === 1 ? '' : 's'} left`
    : 'Drops remaining';
}

export function getLastPlayedTime(game) {
  const timestamp = Number(game?.lastPlayed);
  if (Number.isFinite(timestamp) && timestamp > 0) return timestamp * 1000;

  const parsedDate = Date.parse(game?.lastPlayedDate || '');
  return Number.isNaN(parsedDate) ? 0 : parsedDate;
}

export function hasPlaceholderGameName(game) {
  const name = String(game?.name || '').trim();
  return !name || /^Steam App\s+\d+$/i.test(name);
}

export function getDisplayGameName(game) {
  return hasPlaceholderGameName(game) ? 'Loading game name...' : game.name;
}

export function getGameCoverUrls(game) {
  const appId = Number(game?.appid);
  const suppliedHeader = typeof game?.headerImage === 'string' ? game.headerImage.trim() : '';
  const suppliedCapsule = typeof game?.capsuleImage === 'string' ? game.capsuleImage.trim() : '';
  const generatedUrls = Number.isInteger(appId) && appId > 0
    ? [
      `/api/steam-art/${appId}/header`,
      `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
      `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
      `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`
    ]
    : [];

  return [...new Set([
    ...generatedUrls.slice(0, 1),
    suppliedHeader,
    ...generatedUrls.slice(1),
    suppliedCapsule
  ].filter(Boolean))];
}

export function formatLastPlayed(game) {
  const lastPlayedTime = getLastPlayedTime(game);
  if (!lastPlayedTime) return 'Recently played';

  const lastPlayedDate = new Date(lastPlayedTime);
  const includeYear = lastPlayedDate.getFullYear() !== new Date().getFullYear();
  return `Last played ${lastPlayedDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {})
  })}`;
}

export function getPaginationItems(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, 'ellipsis-end', totalPages];
  }
  if (currentPage >= totalPages - 3) {
    return [1, 'ellipsis-start', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, 'ellipsis-start', currentPage - 1, currentPage, currentPage + 1, 'ellipsis-end', totalPages];
}

export function parseStoredTaskQueue(stored) {
  if (!Array.isArray(stored)) return [];

  const seen = new Set();
  return stored.flatMap(item => {
    const appId = Number(item?.appId);
    if (!Number.isInteger(appId) || appId <= 0 || appId === 480 || seen.has(appId)) return [];
    seen.add(appId);
    const name = typeof item?.name === 'string' && item.name.trim()
      ? item.name.trim().slice(0, 200)
      : `AppID ${appId}`;
    const rawDropsRemaining = Number(item?.dropsRemaining);
    const dropsRemaining = Number.isSafeInteger(rawDropsRemaining) && rawDropsRemaining > 0
      ? rawDropsRemaining
      : null;
    return [{ appId, name, dropsRemaining }];
  });
}
