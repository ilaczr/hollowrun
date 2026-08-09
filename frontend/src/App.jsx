import { useState, useEffect, useRef } from 'react';
import { 
  Gamepad2, CheckSquare, UserCircle, Activity, Clock, ListChecks, Zap, Hexagon, Search,
  Square, X, History, ListPlus, Play
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
const TASK_QUEUE_STORAGE_PREFIX = 'hollowrun.taskQueue';
const MAX_TASK_QUEUE_ITEMS = 32;
const unavailableCoverUrls = new Set();

async function requestJson(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.success === false) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return data;
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
      return [{ appId, name }];
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
  const [queuedGames, setQueuedGames] = useState([]);
  const [queueOwnerSteamId, setQueueOwnerSteamId] = useState(null);
  const [isQueueStarting, setIsQueueStarting] = useState(false);
  const queueStartInFlight = useRef(false);
  const previousSessionCount = useRef(null);
  
  const fetchData = async () => {
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
  };

  const fetchActivityData = async () => {
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
  };

  const fetchLibraryData = async () => {
    try {
      setGames(await requestJson('/games'));
      setErrorMessage(previous => previous.startsWith('Failed to connect to the HollowRun backend:') ? '' : previous);
    } catch (err) {
      setErrorMessage(`Failed to connect to the HollowRun backend: ${err.message}`);
    }
  };

  useEffect(() => {
    fetchData();
    const activityInterval = setInterval(fetchActivityData, 2000);
    const libraryInterval = setInterval(fetchLibraryData, LIBRARY_REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(activityInterval);
      clearInterval(libraryInterval);
    };
  }, []);

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

  const activeSteamId = status?.activeUser?.steamId;
  useEffect(() => {
    if (!/^7656\d{13}$/.test(String(activeSteamId || ''))) {
      setQueuedGames([]);
      setQueueOwnerSteamId(null);
      return;
    }

    setQueuedGames(readStoredTaskQueue(activeSteamId));
    setQueueOwnerSteamId(activeSteamId);
  }, [activeSteamId]);

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
    const shouldResolveSteamNames = query.length >= 2 && !/^\d+$/.test(query);
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
  }, [searchQuery]);



  const handleStartRun = async (appId, name) => {
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
    const name = hasPlaceholderGameName(game) ? `AppID ${appId}` : getDisplayGameName(game);
    if (queuedGames.length >= MAX_TASK_QUEUE_ITEMS) {
      setErrorMessage(`The task queue can contain at most ${MAX_TASK_QUEUE_ITEMS} games.`);
      return;
    }

    setQueuedGames(previous => {
      if (previous.some(item => item.appId === appId) || previous.length >= MAX_TASK_QUEUE_ITEMS) return previous;
      return [...previous, { appId, name }];
    });
  };

  const handleRemoveQueuedGame = (appId) => {
    setQueuedGames(previous => previous.filter(game => game.appId !== appId));
  };

  const handleStopRun = async (appId) => {
    try {
      await requestJson('/idle/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appid: appId }) });
      await fetchData();
    } catch (err) {
      setErrorMessage(`Could not stop AppID ${appId}: ${err.message}`);
    }
  };

  const handleStopAll = async () => {
    try {
      await requestJson('/idle/stop-all', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      await fetchData();
    } catch (err) {
      setErrorMessage(`Could not stop all sessions: ${err.message}`);
    }
  };

  const startTaskQueue = async ({ interruptCurrent = false } = {}) => {
    if (queueStartInFlight.current || queuedGames.length === 0) return false;

    queueStartInFlight.current = true;
    setIsQueueStarting(true);
    const nextGame = queuedGames[0];

    try {
      if (interruptCurrent && sessions.length > 0) {
        await requestJson('/idle/stop-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const response = await requestJson('/idle/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: nextGame.appId, name: nextGame.name })
      });
      const result = response.results?.[0];
      if (!result?.success) throw new Error(result?.error || 'Steam worker failed to start');

      setQueuedGames(previous => previous.filter(game => game.appId !== nextGame.appId));
      await fetchData();
      return true;
    } catch (error) {
      setErrorMessage(`Could not start queued game ${nextGame.name}: ${error.message}`);
      await fetchActivityData();
      return false;
    } finally {
      queueStartInFlight.current = false;
      setIsQueueStarting(false);
    }
  };

  const gamesByAppId = new Map(games.installed.map(game => {
    const enriched = enrichedGameInfo[game.appid];
    return [game.appid, {
      ...game,
      ...(enriched?.name ? { name: enriched.name } : {}),
      ...(enriched?.headerImage ? { headerImage: enriched.headerImage } : {}),
      ...(enriched?.capsuleImage ? { capsuleImage: enriched.capsuleImage } : {}),
      metadataReady: Boolean(game.metadataReady || enriched?.metadataReady),
      type: game.source || 'installed'
    }];
  }));
  const allGames = Array.from(gamesByAppId.values());

  const activeSessionMap = new Map(sessions.map(s => [s.appId, s]));
  const pendingQueuedGames = queuedGames
    .filter(game => !activeSessionMap.has(game.appId))
    .map(game => {
      const libraryGame = gamesByAppId.get(game.appId);
      return {
        ...game,
        name: libraryGame && !hasPlaceholderGameName(libraryGame)
          ? libraryGame.name
          : game.name
      };
    });
  const queuedAppIds = new Set(pendingQueuedGames.map(game => game.appId));

  useEffect(() => {
    if (loading) return;

    const previousCount = previousSessionCount.current;
    previousSessionCount.current = sessions.length;
    if (
      previousCount !== null
      && previousCount > 0
      && sessions.length === 0
      && queuedGames.length > 0
      && !queueStartInFlight.current
    ) {
      startTaskQueue();
    }
    // The transition counters intentionally gate this effect; the callback
    // reads the latest queue and session state from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, sessions.length, queuedGames.length]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  const tabGames = activeTab === 'installed'
    ? allGames.filter(game => game.installed)
    : activeTab === 'recent'
      ? allGames
        .filter(game => getLastPlayedTime(game) > 0)
        .sort((left, right) => getLastPlayedTime(right) - getLastPlayedTime(left))
        .slice(0, MAX_RECENT_GAMES)
      : allGames;
  const localSearchMatches = isSearching
    ? allGames.filter(game => (
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
      recent: 'Recent Games'
    }[activeTab] || 'Library');

  const isElectron = navigator.userAgent.includes('Electron');
  const profileWallpaperStyle = status?.activeUser?.profileWallpaperUrl
    ? { '--profile-wallpaper-image': `url("${status.activeUser.profileWallpaperUrl}")` }
    : undefined;
  const profileWallpaperVideoUrl = status?.activeUser?.profileWallpaperVideoUrl || null;
  const profileWallpaperVideoType = status?.activeUser?.profileWallpaperVideoType || 'video/webm';

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
      {profileWallpaperVideoUrl && (
        <video
          className="profile-wallpaper-video"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster={status?.activeUser?.profileWallpaperUrl || undefined}
          aria-hidden="true"
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
          <button type="button" className={`nav-item ${activeTab === 'recent' ? 'active' : ''}`} onClick={() => setActiveTab('recent')}>
            <History size={18} className="nav-icon" />
            <span>Recent Games</span>
          </button>
        </div>

        <div className="sidebar-profile">
          <div className="profile-info">
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
            <div className="profile-copy">
              <div className="profile-name">{status?.activeUser?.personaName || 'Steam Client'}</div>
              <div className="profile-subtitle">Local Steam session</div>
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
                <>Across all game sections <span className="highlight">{isStoreSearchPending ? 'Checking Steam titles...' : `${filteredGames.length} games.`}</span></>
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
            Games <span className="badge">{sessions.length} Running</span>
          </div>
        </div>

        {/* Games Grid */}
        <div className="games-grid">
          {pagedGames.length === 0 && (
            <div className="empty-state games-empty-state">
              {isSearching
                ? 'No games owned by the active Steam account match this search.'
                : 'No games could be verified for the active Steam account.'}
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
                    <div className="game-actions">
                      <button className="manage-btn" onClick={(e) => { e.stopPropagation(); handleStartRun(game.appid, sessionName); }}>Start</button>
                      <button
                        className="manage-btn queue-btn"
                        disabled={isQueued}
                        onClick={(e) => { e.stopPropagation(); handleQueueGame(game); }}
                      >
                        <ListPlus size={14} /> {isQueued ? 'Queued' : 'Queue'}
                      </button>
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
                    <span className="task-sub">Idling now</span>
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
            <span id="task-queue-heading">Task Queue</span>
            <div className="task-section-controls">
              <button
                type="button"
                className="queue-start-btn"
                disabled={pendingQueuedGames.length === 0 || isQueueStarting}
                title="Stop current idling games and start the first queued game"
                onClick={() => startTaskQueue({ interruptCurrent: true })}
              >
                <Play size={11} fill="currentColor" />
                {isQueueStarting ? 'Starting...' : 'Start Queue'}
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
                  <div className="task-sub">{index === 0 ? 'Next in queue' : `Queue position ${index + 1}`}</div>
                </div>
                <div className="task-queue-actions">
                  <button className="task-remove-btn" disabled={isQueueStarting} aria-label={`Remove ${game.name} from queue`} title="Remove from queue" onClick={() => handleRemoveQueuedGame(game.appId)}>
                    <X size={11} />
                  </button>
                </div>
              </div>
            ))}
            {pendingQueuedGames.length === 0 && (
              <div className="task-empty-state">No pending games</div>
            )}
          </div>
        </section>
        
      </aside>
    </div>
  );
}
