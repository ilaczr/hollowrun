import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Gamepad2, CheckSquare, UserCircle, Activity, Clock, ListChecks, Zap, Hexagon, Search,
  Square, X, History, ListPlus, Play, CreditCard
} from 'lucide-react';
import './loading.css';

const API_BASE = '/api';
const BRAND_LOGO = '/hollowrun.svg';
const GAMES_PER_PAGE = 16;
const MAX_RECENT_PAGES = 5;
const MAX_RECENT_GAMES = GAMES_PER_PAGE * MAX_RECENT_PAGES;
const METADATA_CHUNK_SIZE = 4;
const NEIGHBOUR_PREFETCH_DELAY_MS = 350;
const LIBRARY_REFRESH_INTERVAL_MS = 30000;
const CARD_DROP_REFRESH_INTERVAL_MS = 60000;
const QUEUE_CARD_DROP_REFRESH_INTERVAL_MS = 60000;
const BULK_QUEUE_CARD_DROP_REFRESH_INTERVAL_MS = 120000;
const MAX_CONCURRENT_CARD_GAMES = 32;
const TASK_QUEUE_STORAGE_PREFIX = 'hollowrun.taskQueue';
const unavailableCoverUrls = new Set();

async function requestJson(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.success === false) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return data;
}

function normalizeCardDropGames(games) {
  const seen = new Set();
  return (Array.isArray(games) ? games : []).flatMap(game => {
    const appId = Number(game?.appId);
    if (!Number.isSafeInteger(appId) || appId <= 10 || seen.has(appId)) return [];
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

async function streamCardDrops({ force = false, signal, onUpdate }) {
  const response = await fetch(`${API_BASE}/card-drops/stream${force ? '?force=1' : ''}`, {
    headers: { Accept: 'application/x-ndjson' },
    signal
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult = null;

  const processLine = line => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message?.success === false) throw new Error('Card-drop scan failed.');
    if (message?.success !== true) return;
    onUpdate(message);
    if (message.progress !== true) finalResult = message;
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      processLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
    }
    if (done) break;
  }
  processLine(buffer);
  if (!finalResult) throw new Error('Card-drop scan ended without a final result.');
  return finalResult;
}

function formatTimer(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatPlaytime(minutes) {
  if (!minutes || minutes === 0) return null;
  if (minutes < 60) return `${minutes}m`;
  const hrs = (minutes / 60).toFixed(1);
  return `${hrs}h`;
}

function formatDropsLeft(value) {
  return Number.isSafeInteger(value) && value > 0
    ? `${value} drop${value === 1 ? '' : 's'} left`
    : 'Drops remaining';
}

function getLastPlayedTime(game) {
  const timestamp = Number(game?.lastPlayed);
  if (Number.isFinite(timestamp) && timestamp > 0) return timestamp * 1000;

  const parsedDate = Date.parse(game?.lastPlayedDate || '');
  return Number.isNaN(parsedDate) ? 0 : parsedDate;
}

function formatLastPlayed(game) {
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

function getPaginationItems(currentPage, totalPages) {
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

function hasPlaceholderGameName(game) {
  const name = String(game?.name || '').trim();
  return !name || /^Steam App\s+\d+$/i.test(name);
}

function getDisplayGameName(game) {
  return hasPlaceholderGameName(game) ? 'Loading game name...' : game.name;
}

function getGameCoverUrls(game) {
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

function GameCoverFallback({ game, displayName }) {
  const [iconUnavailable, setIconUnavailable] = useState(false);

  return (
    <div className="game-cover-fallback" role="img" aria-label={`No cover available for ${displayName}`}>
      {!iconUnavailable ? (
        <img
          src={`/api/steam-art/${game.appid}/icon`}
          alt=""
          aria-hidden="true"
          className="game-cover-icon"
          decoding="async"
          onError={() => setIconUnavailable(true)}
        />
      ) : (
        <img src={BRAND_LOGO} alt="" aria-hidden="true" className="game-cover-brand-logo" />
      )}
      <span className="game-cover-name">Artwork unavailable</span>
      <span className="game-cover-appid">AppID {game.appid}</span>
    </div>
  );
}

function GameCover({ game }) {
  const displayName = getDisplayGameName(game);
  const [, retryCover] = useState(0);
  const coverUrl = getGameCoverUrls(game).find(url => !unavailableCoverUrls.has(url)) || '';

  if (!coverUrl) {
    return <GameCoverFallback game={game} displayName={displayName} />;
  }

  return (
    <img
      src={coverUrl}
      alt=""
      aria-hidden="true"
      className="game-image"
      loading="lazy"
      decoding="async"
      draggable="false"
      referrerPolicy="no-referrer"
      onError={() => {
        unavailableCoverUrls.add(coverUrl);
        retryCover(attempt => attempt + 1);
      }}
    />
  );
}

function GameIcon({ appId, name }) {
  const [iconUnavailable, setIconUnavailable] = useState(false);

  return (
    <div className="task-icon-box">
      <img
        key={iconUnavailable ? 'fallback' : appId}
        src={iconUnavailable ? BRAND_LOGO : `/api/steam-art/${appId}/icon`}
        alt=""
        aria-hidden="true"
        className={`task-icon-image ${iconUnavailable ? 'fallback' : ''}`}
        title={name}
        onError={() => setIconUnavailable(true)}
      />
    </div>
  );
}

function readStoredTaskQueue(steamId) {
  try {
    const stored = JSON.parse(localStorage.getItem(`${TASK_QUEUE_STORAGE_PREFIX}.${steamId}`) || '[]');
    if (!Array.isArray(stored)) return [];

    const seen = new Set();
    return stored.slice(0, MAX_TASK_QUEUE_ITEMS).flatMap(item => {
      const appId = Number(item?.appId);
      if (!Number.isInteger(appId) || appId <= 0 || seen.has(appId)) return [];
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
  } catch {
    return [];
  }
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [games, setGames] = useState({ installed: [], libraryStats: null });
  const [sessions, setSessions] = useState([]);
  const [activeTab, setActiveTab] = useState('installed');
  const [searchQuery, setSearchQuery] = useState('');
  const [storeSearchResults, setStoreSearchResults] = useState([]);
  const [isStoreSearchPending, setIsStoreSearchPending] = useState(false);
  const [enrichedGameInfo, setEnrichedGameInfo] = useState({});
  const enrichmentInFlight = useRef(new Set());
  const [gamePage, setGamePage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [avatarFrameLoadFailed, setAvatarFrameLoadFailed] = useState(false);
  const [miniBackgroundLoadFailed, setMiniBackgroundLoadFailed] = useState(false);
  const [miniBackgroundVideoLoadFailed, setMiniBackgroundVideoLoadFailed] = useState(false);
  const [profileWallpaperVideoLoadFailed, setProfileWallpaperVideoLoadFailed] = useState(false);
  const [queuedGames, setQueuedGames] = useState([]);
  const [queueOwnerSteamId, setQueueOwnerSteamId] = useState(null);
  const [isQueueStarting, setIsQueueStarting] = useState(false);
  const [queueStartingMode, setQueueStartingMode] = useState(null);
  const [isQueueActive, setIsQueueActive] = useState(false);
  const [queueCurrentAppId, setQueueCurrentAppId] = useState(null);
  const [queueCurrentDropsRemaining, setQueueCurrentDropsRemaining] = useState(null);
  const [bulkQueueAppIds, setBulkQueueAppIds] = useState([]);
  const [bulkQueueDropCounts, setBulkQueueDropCounts] = useState({});
  const [cardDrops, setCardDrops] = useState({
    status: 'idle', games: [], incomplete: false, scannedPages: 0, totalPages: 0
  });
  const queueStartInFlight = useRef(false);
  const queueAdvanceInFlight = useRef(false);
  const queueRunGeneration = useRef(0);
  const cardScanRequestId = useRef(0);
  const cardScanAbortController = useRef(null);
  const cardDropChecksInFlight = useRef(new Set());
  const bulkQueueStopsInFlight = useRef(new Set());
  const isBulkQueueActive = bulkQueueAppIds.length > 0;
  const isAnyQueueActive = isQueueActive || isBulkQueueActive;
  
  const fetchData = useCallback(async () => {
    try {
      const [statusRes, gamesRes, sessionsRes] = await Promise.all([
        requestJson('/status'),
        requestJson('/games'),
        requestJson('/sessions')
      ]);
      setStatus(statusRes);
      setGames(gamesRes);
      setSessions(sessionsRes.sessions || []);
      setErrorMessage(previous => previous.startsWith('Failed to connect to the HollowRun backend:') ? '' : previous);
    } catch (err) {
      setErrorMessage(`Failed to connect to the HollowRun backend: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchActivityData = useCallback(async () => {
    try {
      const [statusRes, sessionsRes] = await Promise.all([
        requestJson('/status'),
        requestJson('/sessions')
      ]);
      setStatus(statusRes);
      setSessions(sessionsRes.sessions || []);
      setErrorMessage(previous => previous.startsWith('Failed to connect to the HollowRun backend:') ? '' : previous);
    } catch (err) {
      setErrorMessage(`Failed to connect to the HollowRun backend: ${err.message}`);
    }
  }, []);

  const fetchLibraryData = useCallback(async () => {
    try {
      setGames(await requestJson('/games'));
      setErrorMessage(previous => previous.startsWith('Failed to connect to the HollowRun backend:') ? '' : previous);
    } catch (err) {
      setErrorMessage(`Failed to connect to the HollowRun backend: ${err.message}`);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const activityInterval = setInterval(fetchActivityData, 2000);
    const libraryInterval = setInterval(fetchLibraryData, LIBRARY_REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(activityInterval);
      clearInterval(libraryInterval);
    };
  }, [fetchActivityData, fetchData, fetchLibraryData]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSessions(prev => prev.map(s => ({ ...s, elapsedSeconds: s.elapsedSeconds + 1 })));
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [status?.activeUser?.avatarUrl]);

  useEffect(() => {
    setAvatarFrameLoadFailed(false);
  }, [status?.activeUser?.avatarFrameUrl]);

  useEffect(() => {
    setMiniBackgroundLoadFailed(false);
  }, [status?.activeUser?.miniProfileBackgroundUrl]);

  useEffect(() => {
    setMiniBackgroundVideoLoadFailed(false);
  }, [status?.activeUser?.miniProfileBackgroundVideoUrl]);

  useEffect(() => {
    setProfileWallpaperVideoLoadFailed(false);
  }, [status?.activeUser?.profileWallpaperVideoUrl]);

  const activeSteamId = status?.activeUser?.steamId;

  const fetchCardDrops = useCallback(async ({ force = false, quiet = false } = {}) => {
    const steamId = String(activeSteamId || '');
    if (!/^7656\d{13}$/.test(steamId)) {
      setCardDrops({
        status: 'unavailable', games: [], incomplete: false, scannedPages: 0, totalPages: 0
      });
      return;
    }

    const requestId = ++cardScanRequestId.current;
    cardScanAbortController.current?.abort();
    const controller = new AbortController();
    cardScanAbortController.current = controller;
    if (!quiet) {
      setCardDrops(previous => ({
        ...previous,
        status: 'loading',
        games: [],
        incomplete: true,
        scannedPages: 0,
        totalPages: 0
      }));
    }

    try {
      await streamCardDrops({
        force,
        signal: controller.signal,
        onUpdate: result => {
          if (requestId !== cardScanRequestId.current) return;
          const nextGames = normalizeCardDropGames(result.games);
          setCardDrops(previous => {
            let visibleGames = nextGames;
            if (quiet && result.progress === true) {
              const merged = new Map(previous.games.map(game => [game.appId, game]));
              nextGames.forEach(game => merged.set(game.appId, game));
              visibleGames = Array.from(merged.values());
            }
            return {
              status: result.progress === true ? 'loading' : 'ready',
              games: visibleGames,
              incomplete: result.incomplete === true,
              scannedPages: Number(result.scannedPages) || 0,
              totalPages: Number(result.totalPages) || 0
            };
          });
        }
      });
    } catch (error) {
      if (error.name !== 'AbortError' && requestId === cardScanRequestId.current) {
        setCardDrops({
          status: 'unavailable', games: [], incomplete: false, scannedPages: 0, totalPages: 0
        });
      }
    } finally {
      if (cardScanAbortController.current === controller) cardScanAbortController.current = null;
    }
  }, [activeSteamId]);

  const refreshCardDropGame = useCallback(async appId => {
    const normalizedAppId = Number(appId);
    if (!Number.isSafeInteger(normalizedAppId) || normalizedAppId <= 10) return null;
    if (cardDropChecksInFlight.current.has(normalizedAppId)) return null;
    cardDropChecksInFlight.current.add(normalizedAppId);

    try {
      const result = await requestJson(`/card-drops/check/${normalizedAppId}`);
      if (String(result.steamId || '') !== String(activeSteamId || '')) return null;
      const dropsRemaining = Number(result.dropsRemaining);
      if (!Number.isSafeInteger(dropsRemaining) || dropsRemaining < 0) return null;

      setCardDrops(previous => {
        const games = new Map(previous.games.map(game => [game.appId, game]));
        if (dropsRemaining > 0) {
          games.set(normalizedAppId, { appId: normalizedAppId, dropsRemaining });
        } else {
          games.delete(normalizedAppId);
        }
        return { ...previous, games: Array.from(games.values()) };
      });
      return dropsRemaining;
    } catch {
      return null;
    } finally {
      cardDropChecksInFlight.current.delete(normalizedAppId);
    }
  }, [activeSteamId]);

  useEffect(() => {
    queueRunGeneration.current += 1;
    setIsQueueActive(false);
    setQueueCurrentAppId(null);
    setQueueCurrentDropsRemaining(null);
    setBulkQueueAppIds([]);
    setBulkQueueDropCounts({});
    setQueueStartingMode(null);
    if (!/^7656\d{13}$/.test(String(activeSteamId || ''))) {
      setQueuedGames([]);
      setQueueOwnerSteamId(null);
      return;
    }

    setQueuedGames(readStoredTaskQueue(activeSteamId));
    setQueueOwnerSteamId(activeSteamId);
  }, [activeSteamId]);

  useEffect(() => {
    cardScanRequestId.current += 1;
    cardScanAbortController.current?.abort();
    setCardDrops({
      status: 'idle', games: [], incomplete: false, scannedPages: 0, totalPages: 0
    });
  }, [activeSteamId]);

  useEffect(() => {
    if (activeTab !== 'cards' && !isBulkQueueActive) return undefined;
    const bulkRefresh = isBulkQueueActive;
    fetchCardDrops({ force: bulkRefresh, quiet: bulkRefresh });
    const interval = setInterval(
      () => fetchCardDrops({ force: bulkRefresh, quiet: true }),
      bulkRefresh ? BULK_QUEUE_CARD_DROP_REFRESH_INTERVAL_MS : CARD_DROP_REFRESH_INTERVAL_MS
    );
    return () => {
      clearInterval(interval);
      cardScanAbortController.current?.abort();
    };
  }, [activeTab, fetchCardDrops, isBulkQueueActive]);

  useEffect(() => {
    if (!isQueueActive || !queueCurrentAppId) return undefined;
    let cancelled = false;
    const refreshCurrentGame = async () => {
      const dropsRemaining = await refreshCardDropGame(queueCurrentAppId);
      if (!cancelled && dropsRemaining !== null) setQueueCurrentDropsRemaining(dropsRemaining);
    };

    refreshCurrentGame();
    const interval = setInterval(refreshCurrentGame, QUEUE_CARD_DROP_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isQueueActive, queueCurrentAppId, refreshCardDropGame]);

  useEffect(() => {
    if (!queueOwnerSteamId || queueOwnerSteamId !== activeSteamId) return;
    try {
      localStorage.setItem(`${TASK_QUEUE_STORAGE_PREFIX}.${queueOwnerSteamId}`, JSON.stringify(queuedGames));
    } catch {
      // The in-memory queue remains usable if browser storage is unavailable.
    }
  }, [activeSteamId, queueOwnerSteamId, queuedGames]);

  useEffect(() => {
    const query = searchQuery.trim();
    const shouldResolveSteamNames = activeTab !== 'cards' && query.length >= 2 && !/^\d+$/.test(query);
    if (!shouldResolveSteamNames) {
      setStoreSearchResults([]);
      setIsStoreSearchPending(false);
      return undefined;
    }

    const controller = new AbortController();
    setStoreSearchResults([]);
    setIsStoreSearchPending(true);
    const timer = setTimeout(async () => {
      try {
        const response = await requestJson(`/search-steam-store?q=${encodeURIComponent(query)}`, {
          signal: controller.signal
        });
        setStoreSearchResults(Array.isArray(response.results) ? response.results : []);
      } catch (error) {
        if (error.name !== 'AbortError') setStoreSearchResults([]);
      } finally {
        if (!controller.signal.aborted) setIsStoreSearchPending(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeTab, searchQuery]);



  const handleStartRun = async (appId, name) => {
    if (isAnyQueueActive || isQueueStarting) {
      setErrorMessage('Pause the card-drop queue before starting another game.');
      return false;
    }
    try {
      const response = await requestJson('/idle/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appid: appId, name }) });
      const result = response.results?.[0];
      if (!result?.success) throw new Error(result?.error || 'Steam worker failed to start');
      setQueuedGames(previous => previous.filter(game => game.appId !== appId));
      await fetchData();
      return true;
    } catch (err) {
      setErrorMessage(`Could not start AppID ${appId}: ${err.message}`);
      return false;
    }
  };

  const handleQueueGame = (game) => {
    const appId = Number(game?.appid);
    if (!Number.isInteger(appId) || appId <= 0) return;
    const cardGame = cardDrops.games.find(item => item.appId === appId);
    if (!cardGame) {
      setErrorMessage('Only games with card drops remaining can be queued.');
      return;
    }
    const name = hasPlaceholderGameName(game) ? `AppID ${appId}` : getDisplayGameName(game);

    setQueuedGames(previous => {
      if (previous.some(item => item.appId === appId)) return previous;
      return [...previous, { appId, name, dropsRemaining: cardGame.dropsRemaining }];
    });
  };

  const handleRemoveQueuedGame = (appId) => {
    setQueuedGames(previous => previous.filter(game => game.appId !== appId));
  };

  const pauseTaskQueue = useCallback(() => {
    queueRunGeneration.current += 1;
    setIsQueueActive(false);
    setQueueCurrentAppId(null);
    setQueueCurrentDropsRemaining(null);
    setBulkQueueAppIds([]);
    setBulkQueueDropCounts({});
  }, []);

  const removeBulkQueueRun = useCallback(appId => {
    setBulkQueueAppIds(previous => previous.filter(currentAppId => currentAppId !== appId));
    setBulkQueueDropCounts(previous => {
      const next = { ...previous };
      delete next[appId];
      return next;
    });
  }, []);

  const handleStopRun = async (appId) => {
    const shouldRefreshDrops = queueCurrentAppId === appId
      || bulkQueueAppIds.includes(appId)
      || cardDrops.games.some(game => game.appId === appId);
    if (isQueueActive) {
      pauseTaskQueue();
    } else if (bulkQueueAppIds.includes(appId)) {
      removeBulkQueueRun(appId);
    }
    try {
      await requestJson('/idle/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appid: appId }) });
      await fetchData();
      if (shouldRefreshDrops) await refreshCardDropGame(appId);
    } catch (err) {
      setErrorMessage(`Could not stop AppID ${appId}: ${err.message}`);
    }
  };

  const handleStopAll = async () => {
    const knownCardAppIds = new Set(cardDrops.games.map(game => game.appId));
    if (queueCurrentAppId) knownCardAppIds.add(queueCurrentAppId);
    bulkQueueAppIds.forEach(appId => knownCardAppIds.add(appId));
    const cardAppIdsToRefresh = sessions
      .map(session => session.appId)
      .filter(appId => knownCardAppIds.has(appId));
    pauseTaskQueue();
    try {
      await requestJson('/idle/stop-all', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      await fetchData();
      if (cardAppIdsToRefresh.length === 1) {
        await refreshCardDropGame(cardAppIdsToRefresh[0]);
      } else if (cardAppIdsToRefresh.length > 1) {
        await fetchCardDrops({ force: true, quiet: true });
      }
    } catch (err) {
      setErrorMessage(`Could not stop all sessions: ${err.message}`);
    }
  };

  const startTaskQueue = useCallback(async ({ continuing = false, runGeneration = null } = {}) => {
    if (queueStartInFlight.current) return false;
    if (!continuing && sessions.length > 0) {
      setErrorMessage('Stop all running games before starting the card-drop queue.');
      return false;
    }

    const eligibleAppIds = new Set(cardDrops.games.map(game => game.appId));
    const runningAppIds = new Set(sessions.map(session => session.appId));
    const nextGame = queuedGames.find(game => (
      eligibleAppIds.has(game.appId) && !runningAppIds.has(game.appId)
    ));
    if (!nextGame) {
      if (continuing) {
        setIsQueueActive(false);
        setQueueCurrentAppId(null);
        setQueueCurrentDropsRemaining(null);
      }
      return false;
    }
    const nextDropsRemaining = cardDrops.games.find(game => game.appId === nextGame.appId)?.dropsRemaining
      ?? nextGame.dropsRemaining
      ?? null;

    const generation = continuing
      ? runGeneration
      : queueRunGeneration.current + 1;
    if (continuing && generation !== queueRunGeneration.current) return false;
    if (!continuing) queueRunGeneration.current = generation;

    queueStartInFlight.current = true;
    setIsQueueStarting(true);
    setQueueStartingMode('sequential');

    try {
      const response = await requestJson('/idle/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: nextGame.appId, name: nextGame.name })
      });
      const result = response.results?.[0];
      if (!result?.success) throw new Error(result?.error || 'Steam worker failed to start');
      if (generation !== queueRunGeneration.current) {
        await requestJson('/idle/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appid: nextGame.appId })
        }).catch(() => {});
        return false;
      }

      setQueuedGames(previous => previous.filter(game => game.appId !== nextGame.appId));
      setQueueCurrentAppId(nextGame.appId);
      setQueueCurrentDropsRemaining(nextDropsRemaining);
      setIsQueueActive(true);
      await fetchData();
      return true;
    } catch (error) {
      setErrorMessage(`Could not start queued game ${nextGame.name}: ${error.message}`);
      if (generation === queueRunGeneration.current) {
        setIsQueueActive(false);
        setQueueCurrentAppId(null);
        setQueueCurrentDropsRemaining(null);
      }
      await fetchActivityData();
      return false;
    } finally {
      queueStartInFlight.current = false;
      setIsQueueStarting(false);
      setQueueStartingMode(null);
    }
  }, [cardDrops.games, fetchActivityData, fetchData, queuedGames, sessions]);

  const startAllQueuedGames = async () => {
    if (queueStartInFlight.current) return false;
    if (sessions.length > 0 || isAnyQueueActive) {
      setErrorMessage('Stop all running games before starting every queued game.');
      return false;
    }

    const eligibleAppIds = new Set(cardDrops.games.map(game => game.appId));
    const reportedMaximum = Number.isSafeInteger(status?.maxIdleSessions)
      ? status.maxIdleSessions
      : MAX_CONCURRENT_CARD_GAMES;
    const maximumSessions = Math.min(MAX_CONCURRENT_CARD_GAMES, Math.max(1, reportedMaximum));
    const gamesToStart = queuedGames
      .filter(game => eligibleAppIds.has(game.appId))
      .slice(0, maximumSessions);
    if (gamesToStart.length === 0) return false;

    const generation = queueRunGeneration.current + 1;
    queueRunGeneration.current = generation;
    queueStartInFlight.current = true;
    setIsQueueStarting(true);
    setQueueStartingMode('all');

    try {
      const startResults = await Promise.all(gamesToStart.map(async game => {
        try {
          const response = await requestJson('/idle/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appid: game.appId, name: game.name })
          });
          const result = response.results?.[0];
          return result?.success
            ? { success: true, game, session: result.session }
            : { success: false, game, error: result?.error || 'Steam worker failed to start' };
        } catch (error) {
          return { success: false, game, error: error.message };
        }
      }));
      const successful = startResults.filter(result => result.success);

      if (generation !== queueRunGeneration.current) {
        await Promise.all(successful.map(({ game }) => requestJson('/idle/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appid: game.appId })
        }).catch(() => {})));
        return false;
      }

      if (successful.length > 0) {
        const startedAppIds = new Set(successful.map(({ game }) => game.appId));
        const currentCounts = new Map(cardDrops.games.map(game => [game.appId, game.dropsRemaining]));
        setQueuedGames(previous => previous.filter(game => !startedAppIds.has(game.appId)));
        setBulkQueueAppIds(successful.map(({ game }) => game.appId));
        setBulkQueueDropCounts(Object.fromEntries(successful.map(({ game }) => [
          game.appId,
          currentCounts.get(game.appId) ?? game.dropsRemaining ?? null
        ])));
        setSessions(previous => {
          const next = new Map(previous.map(session => [session.appId, session]));
          successful.forEach(({ session }) => {
            if (session?.appId) next.set(session.appId, session);
          });
          return Array.from(next.values());
        });
      }

      const failed = startResults.filter(result => !result.success);
      if (failed.length > 0) {
        setErrorMessage(
          `${successful.length} queued game${successful.length === 1 ? '' : 's'} started; `
          + `${failed.length} failed and remain queued.`
        );
      }
      await fetchData();
      return successful.length > 0;
    } catch (error) {
      if (generation === queueRunGeneration.current) {
        setErrorMessage(`Could not start the card-drop queue: ${error.message}`);
      }
      await fetchActivityData();
      return false;
    } finally {
      queueStartInFlight.current = false;
      setIsQueueStarting(false);
      setQueueStartingMode(null);
    }
  };

  const gamesByAppId = useMemo(() => new Map(games.installed.map(game => {
    const enriched = enrichedGameInfo[game.appid];
    return [game.appid, {
      ...game,
      ...(enriched?.name ? { name: enriched.name } : {}),
      ...(enriched?.headerImage ? { headerImage: enriched.headerImage } : {}),
      ...(enriched?.capsuleImage ? { capsuleImage: enriched.capsuleImage } : {}),
      metadataReady: Boolean(game.metadataReady || enriched?.metadataReady),
      type: game.source || 'installed'
    }];
  })), [enrichedGameInfo, games.installed]);
  const allGames = Array.from(gamesByAppId.values());
  const cardDropGames = useMemo(() => cardDrops.games.map(cardGame => {
    const libraryGame = gamesByAppId.get(cardGame.appId);
    if (libraryGame) return { ...libraryGame, cardDropsRemaining: cardGame.dropsRemaining };

    const enriched = enrichedGameInfo[cardGame.appId];
    return {
      appid: cardGame.appId,
      name: enriched?.name || `Steam App ${cardGame.appId}`,
      installed: false,
      source: 'cards',
      playtimeMinutes: 0,
      lastPlayed: 0,
      lastPlayedDate: null,
      headerImage: enriched?.headerImage || null,
      capsuleImage: enriched?.capsuleImage || null,
      metadataReady: Boolean(enriched?.metadataReady),
      type: 'cards',
      cardDropsRemaining: cardGame.dropsRemaining
    };
  }), [cardDrops.games, enrichedGameInfo, gamesByAppId]);
  const cardDropByAppId = useMemo(
    () => new Map(cardDropGames.map(game => [game.appid, game])),
    [cardDropGames]
  );
  const cardDropAppIds = useMemo(() => new Set(cardDropByAppId.keys()), [cardDropByAppId]);

  const activeSessionMap = useMemo(() => new Map(sessions.map(s => [s.appId, s])), [sessions]);
  const bulkQueueAppIdSet = useMemo(() => new Set(bulkQueueAppIds), [bulkQueueAppIds]);
  const pendingQueuedGames = queuedGames
    .filter(game => cardDropAppIds.has(game.appId) && !activeSessionMap.has(game.appId))
    .map(game => {
      const libraryGame = gamesByAppId.get(game.appId);
      const cardGame = cardDropByAppId.get(game.appId);
      return {
        ...game,
        name: libraryGame && !hasPlaceholderGameName(libraryGame)
          ? libraryGame.name
          : game.name,
        dropsRemaining: cardGame?.cardDropsRemaining ?? game.dropsRemaining
      };
    });
  const queuedAppIds = new Set(pendingQueuedGames.map(game => game.appId));

  useEffect(() => {
    if (cardDrops.status !== 'ready' || cardDrops.incomplete) return;
    setQueuedGames(previous => {
      const next = previous.filter(game => cardDropAppIds.has(game.appId));
      return next.length === previous.length ? previous : next;
    });
  }, [cardDrops.incomplete, cardDrops.status, cardDropAppIds]);

  useEffect(() => {
    if (!isBulkQueueActive || cardDrops.status !== 'ready') return;
    const latestCounts = new Map(cardDrops.games.map(game => [game.appId, game.dropsRemaining]));
    setBulkQueueDropCounts(previous => {
      const next = { ...previous };
      let changed = false;
      for (const appId of bulkQueueAppIds) {
        if (latestCounts.has(appId)) {
          const dropsRemaining = latestCounts.get(appId);
          if (Number.isSafeInteger(dropsRemaining) && next[appId] !== dropsRemaining) {
            next[appId] = dropsRemaining;
            changed = true;
          }
        } else if (!cardDrops.incomplete && next[appId] !== 0) {
          next[appId] = 0;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [bulkQueueAppIds, cardDrops.games, cardDrops.incomplete, cardDrops.status, isBulkQueueActive]);

  useEffect(() => {
    if (!isBulkQueueActive || isQueueStarting) return;
    const completedAppIds = bulkQueueAppIds.filter(appId => (
      bulkQueueDropCounts[appId] === 0
      && activeSessionMap.has(appId)
      && !bulkQueueStopsInFlight.current.has(appId)
    ));
    if (completedAppIds.length === 0) return;
    completedAppIds.forEach(appId => bulkQueueStopsInFlight.current.add(appId));

    const stopCompletedGames = async () => {
      const results = await Promise.all(completedAppIds.map(async appId => {
        try {
          await requestJson('/idle/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appid: appId })
          });
          return { appId, success: true };
        } catch (error) {
          return { appId, success: false, error: error.message };
        }
      }));
      const stoppedAppIds = new Set(results.filter(result => result.success).map(result => result.appId));
      if (stoppedAppIds.size > 0) {
        setBulkQueueAppIds(previous => previous.filter(appId => !stoppedAppIds.has(appId)));
        setBulkQueueDropCounts(previous => {
          const next = { ...previous };
          stoppedAppIds.forEach(appId => delete next[appId]);
          return next;
        });
      }
      const failed = results.filter(result => !result.success);
      if (failed.length > 0) {
        setErrorMessage(`Could not stop ${failed.length} completed card-drop game${failed.length === 1 ? '' : 's'}.`);
      }
      await fetchActivityData();
      completedAppIds.forEach(appId => bulkQueueStopsInFlight.current.delete(appId));
    };

    stopCompletedGames();
  }, [activeSessionMap, bulkQueueAppIds, bulkQueueDropCounts, fetchActivityData, isBulkQueueActive, isQueueStarting]);

  useEffect(() => {
    if (!isBulkQueueActive || isQueueStarting) return;
    const missingAppIds = bulkQueueAppIds.filter(appId => !activeSessionMap.has(appId));
    if (missingAppIds.length === 0) return;
    const missingSet = new Set(missingAppIds);
    setBulkQueueAppIds(previous => previous.filter(appId => !missingSet.has(appId)));
    setBulkQueueDropCounts(previous => {
      const next = { ...previous };
      missingAppIds.forEach(appId => delete next[appId]);
      return next;
    });
  }, [activeSessionMap, bulkQueueAppIds, isBulkQueueActive, isQueueStarting]);

  useEffect(() => {
    if (
      !isQueueActive
      || !queueCurrentAppId
      || queueCurrentDropsRemaining !== 0
      || !activeSessionMap.has(queueCurrentAppId)
      || queueAdvanceInFlight.current
    ) return;

    const completedAppId = queueCurrentAppId;
    const generation = queueRunGeneration.current;
    queueAdvanceInFlight.current = true;

    const advanceQueue = async () => {
      try {
        await requestJson('/idle/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appid: completedAppId })
        });
        if (generation !== queueRunGeneration.current) return;

        setQueueCurrentAppId(null);
        setQueueCurrentDropsRemaining(null);
        await fetchActivityData();
        if (generation !== queueRunGeneration.current) return;
        await startTaskQueue({ continuing: true, runGeneration: generation });
      } catch (error) {
        if (generation === queueRunGeneration.current) {
          pauseTaskQueue();
          setErrorMessage(`Could not advance the card-drop queue: ${error.message}`);
        }
      } finally {
        queueAdvanceInFlight.current = false;
      }
    };

    advanceQueue();
  }, [
    activeSessionMap, fetchActivityData, isQueueActive, pauseTaskQueue,
    queueCurrentAppId, queueCurrentDropsRemaining, sessions, startTaskQueue
  ]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  const tabGames = activeTab === 'installed'
    ? allGames.filter(game => game.installed)
    : activeTab === 'cards'
      ? cardDropGames
    : activeTab === 'recent'
      ? allGames
        .filter(game => getLastPlayedTime(game) > 0)
        .sort((left, right) => getLastPlayedTime(right) - getLastPlayedTime(left))
        .slice(0, MAX_RECENT_GAMES)
      : allGames;
  const searchScopeGames = activeTab === 'cards' ? cardDropGames : allGames;
  const localSearchMatches = isSearching
    ? searchScopeGames.filter(game => (
      String(game.name || '').toLowerCase().includes(normalizedQuery)
      || String(game.appid || '').includes(normalizedQuery)
    ))
    : [];
  const globalSearchMatches = new Map(localSearchMatches.map(game => [game.appid, game]));
  if (isSearching) {
    for (const storeGame of storeSearchResults) {
      const localGame = gamesByAppId.get(storeGame.appid);
      if (localGame) {
        globalSearchMatches.set(storeGame.appid, {
          ...localGame,
          name: storeGame.name || localGame.name,
          headerImage: storeGame.headerImage || localGame.headerImage
        });
      }
    }
  }
  const filteredGames = isSearching ? Array.from(globalSearchMatches.values()) : tabGames;

  const gamePageSize = GAMES_PER_PAGE;
  const pageCount = Math.max(1, Math.ceil(filteredGames.length / gamePageSize));
  const safeGamePage = Math.min(gamePage, pageCount);
  const paginationItems = getPaginationItems(safeGamePage, pageCount);
  const pagedGames = filteredGames.slice((safeGamePage - 1) * gamePageSize, safeGamePage * gamePageSize);
  const pageStart = filteredGames.length === 0 ? 0 : (safeGamePage - 1) * gamePageSize + 1;
  const pageEnd = Math.min(filteredGames.length, safeGamePage * gamePageSize);

  useEffect(() => {
    setGamePage(1);
  }, [activeTab, searchQuery]);
  useEffect(() => {
    setGamePage(page => Math.min(page, pageCount));
  }, [pageCount]);

  const currentMetadataAppIds = pagedGames
    .filter(game => !game.metadataReady)
    .map(game => game.appid);
  const currentMetadataAppIdSet = new Set(currentMetadataAppIds);
  const neighbourStart = Math.max(0, (safeGamePage - 2) * gamePageSize);
  const neighbourEnd = Math.min(filteredGames.length, (safeGamePage + 1) * gamePageSize);
  const neighbourMetadataAppIds = filteredGames
    .slice(neighbourStart, neighbourEnd)
    .filter(game => !game.metadataReady && !currentMetadataAppIdSet.has(game.appid))
    .map(game => game.appid);
  const currentMetadataKey = currentMetadataAppIds.join(',');
  const neighbourMetadataKey = neighbourMetadataAppIds.join(',');

  useEffect(() => {
    const enqueueMetadata = serializedAppIds => {
      const appids = serializedAppIds
        .split(',')
        .map(Number)
        .filter(appId => Number.isInteger(appId) && !enrichmentInFlight.current.has(appId));

      for (let index = 0; index < appids.length; index += METADATA_CHUNK_SIZE) {
        const chunk = appids.slice(index, index + METADATA_CHUNK_SIZE);
        chunk.forEach(appId => enrichmentInFlight.current.add(appId));

        requestJson('/enrich-games', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appids: chunk })
        })
          .then(response => {
            if (!response.games || typeof response.games !== 'object') return;
            setEnrichedGameInfo(previous => ({ ...previous, ...response.games }));
          })
          .catch(() => {
            // Existing names and cover candidates remain available while offline.
          })
          .finally(() => {
            chunk.forEach(appId => enrichmentInFlight.current.delete(appId));
          });
      }
    };

    if (currentMetadataKey) enqueueMetadata(currentMetadataKey);
    const neighbourTimer = neighbourMetadataKey
      ? setTimeout(() => enqueueMetadata(neighbourMetadataKey), NEIGHBOUR_PREFETCH_DELAY_MS)
      : null;

    return () => {
      if (neighbourTimer) clearTimeout(neighbourTimer);
    };
  }, [currentMetadataKey, neighbourMetadataKey]);

  const stats = games.libraryStats || {};
  const pageTitle = isSearching
    ? 'Search Results'
    : ({
      installed: 'Installed Games',
      library: 'Library',
      cards: 'Games With Cards',
      recent: 'Recent Games'
    }[activeTab] || 'Library');
  const cardEmptyMessage = cardDrops.status === 'loading'
    ? 'Checking the active Steam account for games with card drops remaining...'
    : cardDrops.status === 'unavailable'
      ? 'Card-drop information could not be loaded from the running Steam client.'
      : isSearching
        ? 'No games with card drops remaining match this search.'
        : 'No games have card drops remaining.';
  const showCardRetry = cardDrops.status === 'unavailable';
  const cardDropSummary = cardDrops.status === 'ready'
    ? `${filteredGames.length}${cardDrops.incomplete ? '+' : ''} games.`
    : cardDrops.status === 'unavailable'
      ? 'Unavailable.'
      : '';
  const isCardScanRunning = activeTab === 'cards' && cardDrops.status === 'loading';

  const isElectron = navigator.userAgent.includes('Electron');
  const profileWallpaperStyle = status?.activeUser?.profileWallpaperUrl
    ? { '--profile-wallpaper-image': `url("${status.activeUser.profileWallpaperUrl}")` }
    : undefined;
  const profileWallpaperVideoUrl = status?.activeUser?.profileWallpaperVideoUrl || null;
  const profileWallpaperVideoType = status?.activeUser?.profileWallpaperVideoType || 'video/webm';
  const miniProfileBackgroundVideoUrl =
    status?.activeUser?.miniProfileBackgroundVideoUrl || null;
  const miniProfileBackgroundVideoType =
    status?.activeUser?.miniProfileBackgroundVideoType || 'video/webm';

  if (loading) {
    return (
      <div className={`loading-screen ${isElectron ? 'electron-window' : ''}`}>
        {isElectron && <div className="window-drag-region" aria-hidden="true" />}
        <div className="loading-content" role="status" aria-live="polite">
          <div className="loading-brand-mark" aria-hidden="true">
            <img src={BRAND_LOGO} alt="" className="loading-brand-logo" />
          </div>
          <div className="loading-copy">
            <strong>HollowRun</strong>
          </div>
          <div className="loading-progress" aria-hidden="true">
            <span />
          </div>
          <span className="loading-action">Reading your local Steam library...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-layout ${isElectron ? 'electron-window' : ''}`} style={profileWallpaperStyle}>
      {profileWallpaperVideoUrl && !profileWallpaperVideoLoadFailed && (
        <video
          className="profile-wallpaper-video"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster={status?.activeUser?.profileWallpaperUrl || undefined}
          aria-hidden="true"
          onError={() => setProfileWallpaperVideoLoadFailed(true)}
        >
          <source src={profileWallpaperVideoUrl} type={profileWallpaperVideoType} />
        </video>
      )}
      {isElectron && <div className="window-drag-region" aria-hidden="true" />}
      {/* LEFT SIDEBAR */}
      <aside className="sidebar-left">
        <div className="brand-section">
          <div className="brand-icon">
            <img src={BRAND_LOGO} alt="" className="brand-logo" />
          </div>
          <div className="brand-text-block">
            <div className="brand-title">HollowRun</div>
            <div className="brand-version" title="HollowRun application version">
              {status?.appVersion ? `v${status.appVersion}` : 'v—'}
            </div>
          </div>
        </div>

        <div className="nav-menu">
          <button type="button" className={`nav-item ${activeTab === 'installed' ? 'active' : ''}`} onClick={() => setActiveTab('installed')}>
            <Gamepad2 size={18} className="nav-icon" />
            <span>Installed Games</span>
          </button>
          <button type="button" className={`nav-item ${activeTab === 'library' ? 'active' : ''}`} onClick={() => setActiveTab('library')}>
            <CheckSquare size={18} className="nav-icon" />
            <span>Library</span>
          </button>
          <button type="button" className={`nav-item ${activeTab === 'cards' ? 'active' : ''}`} onClick={() => setActiveTab('cards')}>
            <CreditCard size={18} className="nav-icon" />
            <span>Games With Cards</span>
          </button>
          <button type="button" className={`nav-item ${activeTab === 'recent' ? 'active' : ''}`} onClick={() => setActiveTab('recent')}>
            <History size={18} className="nav-icon" />
            <span>Recent Games</span>
          </button>
        </div>

        <div className={`sidebar-profile ${(
          (status?.activeUser?.miniProfileBackgroundUrl && !miniBackgroundLoadFailed)
          || (miniProfileBackgroundVideoUrl && !miniBackgroundVideoLoadFailed)
        ) ? 'has-mini-background' : ''}`}>
          {status?.activeUser?.miniProfileBackgroundUrl && !miniBackgroundLoadFailed && (
            <img
              className="profile-mini-background"
              src={status.activeUser.miniProfileBackgroundUrl}
              alt=""
              aria-hidden="true"
              onError={() => setMiniBackgroundLoadFailed(true)}
            />
          )}
          {miniProfileBackgroundVideoUrl && !miniBackgroundVideoLoadFailed && (
            <video
              className="profile-mini-background"
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              poster={status?.activeUser?.miniProfileBackgroundUrl || undefined}
              aria-hidden="true"
              onError={() => setMiniBackgroundVideoLoadFailed(true)}
            >
              <source
                src={miniProfileBackgroundVideoUrl}
                type={miniProfileBackgroundVideoType}
              />
            </video>
          )}
          <div className="profile-card-shade" aria-hidden="true" />
          <div className="profile-info">
            <div className={`profile-avatar-shell ${status?.activeUser?.avatarFrameUrl && !avatarFrameLoadFailed ? 'has-avatar-frame' : ''}`}>
              <div className="profile-avatar">
                {status?.activeUser?.avatarUrl && !avatarLoadFailed ? (
                  <img
                    src={status.activeUser.avatarUrl}
                    alt={`${status.activeUser.personaName} Steam profile`}
                    onError={() => setAvatarLoadFailed(true)}
                  />
                ) : (
                  <UserCircle size={22} />
                )}
              </div>
              {status?.activeUser?.avatarFrameUrl && !avatarFrameLoadFailed && (
                <img
                  className="profile-avatar-frame"
                  src={status.activeUser.avatarFrameUrl}
                  alt=""
                  aria-hidden="true"
                  onError={() => setAvatarFrameLoadFailed(true)}
                />
              )}
            </div>
            <div className="profile-copy">
              <div className="profile-name">{status?.activeUser?.personaName || 'Steam Client'}</div>
              <div className="profile-subtitle"><span className="profile-status-dot" />Steam connected</div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="main-content">
        {errorMessage && (
          <div className="error-banner" role="alert">
            <span>{errorMessage}</span>
            <button type="button" aria-label="Dismiss error" onClick={() => setErrorMessage('')}><X size={16} /></button>
          </div>
        )}
        <header className="main-header">
          <div className="page-heading">
            <h1 className="page-title">{pageTitle}</h1>
            <div className="page-subtitle">
              {isSearching ? (
                <>{activeTab === 'cards' ? 'Within Games With Cards' : 'Across all game sections'} <span className="highlight">{isStoreSearchPending ? 'Checking Steam titles...' : `${filteredGames.length} games.`}</span></>
              ) : activeTab === 'cards' ? (
                <>Live Steam client card drops {cardDropSummary && <span className="highlight">{cardDropSummary}</span>}</>
              ) : activeTab === 'recent' ? (
                <>Newest local Steam play history <span className="highlight">{filteredGames.length} games.</span></>
              ) : (
                <>Local Steam activity <span className="highlight">{sessions.length} games running.</span></>
              )}
            </div>
          </div>

          <div className="header-clock">
            <Clock size={14} />
            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </header>

        {/* Stats Row */}
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-icon-wrapper"><Gamepad2 size={24} /></div>
            <div className="stat-details">
              <span className="stat-label">RUNNING</span>
              <span className="stat-value">{sessions.length} <span className="stat-capacity">/ {status?.maxIdleSessions ?? '—'}</span></span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper"><Clock size={24} /></div>
            <div className="stat-details">
              <span className="stat-label">TOTAL TIME</span>
              <span className="stat-value">{Math.floor(stats.totalPlaytimeHours || 0)}h</span>
              <span className="stat-subtext">All time library</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper"><Zap size={24} /></div>
            <div className="stat-details">
              <span className="stat-label">TOTAL GAMES</span>
              <span className="stat-value">{stats.totalGames || 0}</span>
              <span className="stat-subtext">Discovered history</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper"><Hexagon size={24} /></div>
            <div className="stat-details">
              <span className="stat-label">INSTALLED</span>
              <span className="stat-value">{stats.installedGames || 0}</span>
              <span className="stat-subtext">Installed locally</span>
            </div>
          </div>
        </div>

        <div className="games-search-wrap" role="search">
          <div className="search-box games-search-box">
            <Search className="search-icon" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search games by name or AppID"
              placeholder="Search by game name or AppID..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {searchQuery && (
              <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setSearchQuery('')}>
                <X size={14} />
              </button>
            )}
            {isStoreSearchPending && <span className="search-spinner" aria-hidden="true" />}
          </div>
        </div>

        {/* Games Section */}
        <div className="section-header">
          <div className="section-title">
            Games <span className="badge">{activeTab === 'cards' ? `${cardDropGames.length}${cardDrops.incomplete ? '+' : ''} With Drops` : `${sessions.length} Running`}</span>
          </div>
          {isCardScanRunning && (
            <div className="card-scan-indicator" role="status" aria-live="polite">
              <span className="card-scan-visual" aria-hidden="true">
                <CreditCard size={16} />
                <span className="card-scan-sweep" />
              </span>
              <span>Scanning card drops</span>
              <span className="card-scan-dots" aria-hidden="true"><i /><i /><i /></span>
            </div>
          )}
        </div>

        {/* Games Grid */}
        <div className="games-grid">
          {pagedGames.length === 0 && (
            <div className={`empty-state games-empty-state ${activeTab === 'cards' ? 'cards-empty-state' : ''}`}>
              <span>
                {activeTab === 'cards'
                  ? cardEmptyMessage
                  : isSearching
                    ? 'No games owned by the active Steam account match this search.'
                    : 'No games could be verified for the active Steam account.'}
              </span>
              {activeTab === 'cards' && showCardRetry && (
                <button type="button" className="empty-state-action" onClick={() => fetchCardDrops({ force: true })}>
                  Try again
                </button>
              )}
            </div>
          )}
          {pagedGames.map(game => {
            const isRunning = activeSessionMap.has(game.appid);
            const session = activeSessionMap.get(game.appid);
            const isQueued = queuedAppIds.has(game.appid);
            const displayName = getDisplayGameName(game);
            const sessionName = hasPlaceholderGameName(game) ? `AppID ${game.appid}` : displayName;
            
            return (
              <div key={game.appid} className={`game-card ${isRunning ? 'running' : isQueued ? 'queued' : ''}`}>
                <div className="game-image-container">
                  <GameCover game={game} />
                  <div className="game-gradient"></div>
                </div>
                <div className="game-info">
                  <div className="game-title" title={displayName}>{displayName}</div>
                  
                  {isRunning && session ? (
                    <div className="game-timer">
                      <Clock size={12} /> {formatTimer(session.elapsedSeconds || 0)}
                    </div>
                  ) : (
                    <div className="game-timer">
                      <Clock size={12} /> {game.playtimeMinutes ? formatPlaytime(game.playtimeMinutes) : 'Not played'}
                    </div>
                  )}

                  <div className="game-subtext">
                    {isRunning
                      ? 'Idling now'
                      : !isSearching && activeTab === 'cards'
                        ? Number.isSafeInteger(game.cardDropsRemaining)
                          ? `${game.cardDropsRemaining} card drop${game.cardDropsRemaining === 1 ? '' : 's'} remaining`
                          : 'Card drops remaining'
                      : !isSearching && activeTab === 'recent'
                        ? formatLastPlayed(game)
                        : game.installed
                          ? 'Installed locally'
                          : game.source === 'history'
                            ? 'Play history'
                            : game.source === 'library'
                              ? 'Steam library'
                              : 'Steam Store'}
                  </div>

                  {isRunning ? (
                    <button className="manage-btn active" onClick={(e) => { e.stopPropagation(); handleStopRun(game.appid); }}>Stop</button>
                  ) : (
                    <div className={`game-actions ${activeTab === 'cards' ? '' : 'single-action'}`}>
                      <button
                        className="manage-btn"
                        disabled={isAnyQueueActive || isQueueStarting}
                        title={isAnyQueueActive || isQueueStarting ? 'Stop the active card-drop run before starting another game' : 'Start idling'}
                        onClick={(e) => { e.stopPropagation(); handleStartRun(game.appid, sessionName); }}
                      >
                        Start
                      </button>
                      {activeTab === 'cards' && (
                        <button
                          className="manage-btn queue-btn"
                          disabled={isQueued || queueCurrentAppId === game.appid}
                          onClick={(e) => { e.stopPropagation(); handleQueueGame(game); }}
                        >
                          <ListPlus size={14} /> {isQueued || queueCurrentAppId === game.appid ? 'Queued' : 'Queue'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {pageCount > 1 && (
          <nav className="page-navigation" aria-label={`${pageTitle} pages`}>
            <button type="button" className="page-nav-btn" aria-label="Previous page" title="Previous page" disabled={safeGamePage <= 1} onClick={() => setGamePage(safeGamePage - 1)}>
              <span aria-hidden="true">&lsaquo;</span>
            </button>
            <div className="page-number-row">
              {paginationItems.map(item => typeof item === 'number' ? (
                <button
                  type="button"
                  key={item}
                  className={`page-number ${safeGamePage === item ? 'active' : ''}`}
                  aria-current={safeGamePage === item ? 'page' : undefined}
                  aria-label={`Page ${item}`}
                  onClick={() => setGamePage(item)}
                >
                  {item}
                </button>
              ) : (
                <span key={item} className="page-ellipsis" aria-hidden="true">&hellip;</span>
              ))}
            </div>
            <button type="button" className="page-nav-btn" aria-label="Next page" title="Next page" disabled={safeGamePage >= pageCount} onClick={() => setGamePage(safeGamePage + 1)}>
              <span aria-hidden="true">&rsaquo;</span>
            </button>
          </nav>
        )}
        
        {filteredGames.length > gamePageSize && (
          <div className="footer-actions">
            <span className="footer-summary">Showing {pageStart}&ndash;{pageEnd} of {filteredGames.length} games</span>
          </div>
        )}
      </main>

      {/* RIGHT SIDEBAR */}
      <aside className="sidebar-right">
        <div className="panel-card">
          <div className="panel-header">
            Current Session
            <Activity size={16} className="panel-icon" />
          </div>
          <div className="session-timer-large">
            {sessions.length > 0 ? formatTimer(Math.max(...sessions.map(s => s.elapsedSeconds || 0))) : '00:00:00'}
          </div>
          <div className="session-subtitle">Session uptime</div>
          
          <div className="session-stat-list">
            <div className="session-stat-row">
              <div className="session-stat-lbl"><Clock size={14} /> Started at</div>
              <div className="session-stat-val">
                {sessions.length > 0 ? new Date(sessions[0].startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
              </div>
            </div>
            <div className="session-stat-row">
              <div className="session-stat-lbl"><Gamepad2 size={14} /> Games running</div>
              <div className="session-stat-val">{sessions.length}</div>
            </div>
            <div className="session-stat-row">
              <div className="session-stat-lbl"><ListChecks size={14} /> Tasks active</div>
              <div className="session-stat-val">{sessions.length}</div>
            </div>
          </div>
          
          {sessions.length > 0 && (
            <button className="stop-all-btn" onClick={handleStopAll}>
              <Square size={16} fill="currentColor" /> Stop All
            </button>
          )}
        </div>

        <section className="task-section current-task-section" aria-labelledby="current-task-heading">
          <div className="panel-header task-section-header">
            <span id="current-task-heading">Current Task</span>
            <span className="badge">{sessions.length}</span>
          </div>

          <div className="task-list current-task-list">
            {sessions.map((session) => (
              <div key={session.appId} className="task-item current">
                <GameIcon appId={session.appId} name={session.gameName} />
                <div className="task-text">
                  <div className="task-title" title={session.gameName}>{session.gameName}</div>
                  <div className="task-meta">
                    <span className="task-sub">
                      {isQueueActive && queueCurrentAppId === session.appId
                        ? formatDropsLeft(queueCurrentDropsRemaining)
                        : bulkQueueAppIdSet.has(session.appId)
                          ? formatDropsLeft(bulkQueueDropCounts[session.appId])
                        : 'Idling now'}
                    </span>
                    <span className="task-elapsed">{formatTimer(session.elapsedSeconds || 0)}</span>
                  </div>
                </div>
                <button
                  className="task-remove-btn"
                  aria-label={`Stop idling ${session.gameName}`}
                  title="Stop idling"
                  onClick={(event) => { event.stopPropagation(); handleStopRun(session.appId); }}
                >
                  <Square size={10} fill="currentColor" />
                </button>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="task-empty-state">No games currently idling</div>
            )}
          </div>
        </section>

        <section className="task-section queue-task-section" aria-labelledby="task-queue-heading">
          <div className="panel-header task-section-header">
            <span id="task-queue-heading">Card Drop Queue</span>
            <div className="task-section-controls">
              <button
                type="button"
                className="queue-start-btn"
                disabled={pendingQueuedGames.length === 0 || isQueueStarting || isAnyQueueActive || sessions.length > 0}
                title={sessions.length > 0
                  ? 'Stop all running games before starting the queue'
                  : isAnyQueueActive
                    ? 'The card-drop queue is running'
                    : 'Run queued games one at a time'}
                onClick={() => startTaskQueue()}
              >
                <Play size={11} fill="currentColor" />
                {isQueueActive
                  ? '1 by 1 Running'
                  : queueStartingMode === 'sequential'
                    ? 'Starting...'
                    : 'Start 1 by 1'}
              </button>
              <button
                type="button"
                className="queue-start-btn"
                disabled={pendingQueuedGames.length === 0 || isQueueStarting || isAnyQueueActive || sessions.length > 0}
                title={sessions.length > 0
                  ? 'Stop all running games before starting the queue'
                  : isAnyQueueActive
                    ? 'The card-drop queue is running'
                    : `Start up to ${MAX_CONCURRENT_CARD_GAMES} queued games together`}
                onClick={startAllQueuedGames}
              >
                <Zap size={11} fill="currentColor" />
                {isBulkQueueActive
                  ? 'All Running'
                  : queueStartingMode === 'all'
                    ? 'Starting...'
                    : 'Start All'}
              </button>
              <span className="badge">{pendingQueuedGames.length}</span>
            </div>
          </div>

          <div className="task-list queue-task-list">
            {pendingQueuedGames.map((game, index) => (
              <div key={`queued-${game.appId}`} className={`task-item queued ${index === 0 ? 'next' : ''}`}>
                <GameIcon appId={game.appId} name={game.name} />
                <div className="task-text">
                  <div className="task-title" title={game.name}>{game.name}</div>
                  <div className="task-sub">
                    {index === 0 ? 'Next' : `Position ${index + 1}`}
                    {Number.isSafeInteger(game.dropsRemaining)
                      ? ` · ${game.dropsRemaining} drop${game.dropsRemaining === 1 ? '' : 's'} remaining`
                      : ''}
                  </div>
                </div>
                <div className="task-queue-actions">
                  <button className="task-remove-btn" disabled={isQueueStarting} aria-label={`Remove ${game.name} from queue`} title="Remove from queue" onClick={() => handleRemoveQueuedGame(game.appId)}>
                    <X size={11} />
                  </button>
                </div>
              </div>
            ))}
            {pendingQueuedGames.length === 0 && (
              <div className="task-empty-state">No card-drop games queued</div>
            )}
          </div>
        </section>
        
      </aside>
    </div>
  );
}
