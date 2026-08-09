import { useState, useEffect } from 'react';
import { 
  Gamepad2, CheckSquare, UserCircle, Settings, Activity, Clock, ListChecks, Zap, Hexagon, Search,
  Square, X
} from 'lucide-react';

const API_BASE = '/api';

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

export default function App() {
  const [status, setStatus] = useState(null);
  const [games, setGames] = useState({ installed: [], presets: [], libraryStats: null });
  const [sessions, setSessions] = useState([]);
  const [activeTab, setActiveTab] = useState('installed');
  const [searchQuery, setSearchQuery] = useState('');
  const [gamePage, setGamePage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  
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

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setSessions(prev => prev.map(s => ({ ...s, elapsedSeconds: s.elapsedSeconds + 1 })));
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);



  const handleStartRun = async (appId, name) => {
    try {
      const response = await requestJson('/idle/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appid: appId, name }) });
      const result = response.results?.[0];
      if (!result?.success) throw new Error(result?.error || 'Steam worker failed to start');
      await fetchData();
    } catch (err) {
      setErrorMessage(`Could not start AppID ${appId}: ${err.message}`);
    }
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

  const allGames = [
    ...games.installed.map(g => ({ ...g, type: g.source || 'installed' })),
    ...games.presets.map(g => ({ ...g, type: 'preset' }))
  ];

  const activeSessionMap = new Map(sessions.map(s => [s.appId, s]));

  const filteredGames = allGames.filter(g => {
    const match = g.name.toLowerCase().includes(searchQuery.toLowerCase()) || g.appid.toString().includes(searchQuery);
    if (!match) return false;
    if (activeTab === 'installed') return g.installed;
    if (activeTab === 'library') return true;
    return true;
  });

  const gamePageSize = 8;
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

  const stats = games.libraryStats || {};
  const pageTitle = {
    installed: 'Installed Games',
    library: 'Library'
  }[activeTab] || 'Library';

  const isElectron = navigator.userAgent.includes('Electron');

  if (loading) {
    return (
      <div className={`loading-screen ${isElectron ? 'electron-window' : ''}`}>
        {isElectron && <div className="window-drag-region" aria-hidden="true" />}
        <span>Loading HollowRun...</span>
      </div>
    );
  }

  return (
    <div className={`app-layout ${isElectron ? 'electron-window' : ''}`}>
      {isElectron && <div className="window-drag-region" aria-hidden="true" />}
      {/* LEFT SIDEBAR */}
      <aside className="sidebar-left">
        <div className="brand-section">
          <div className="brand-icon">
            <Gamepad2 size={20} color="#fff" />
          </div>
          <div className="brand-text-block">
            <div className="brand-title">HollowRun</div>
            <div className="brand-version">v1.0.0</div>
          </div>
        </div>

        <div className="nav-menu">
          <div className={`nav-item ${activeTab === 'installed' ? 'active' : ''}`} onClick={() => setActiveTab('installed')}>
            <Gamepad2 size={18} className="nav-icon" />
            <span>Installed Games</span>
          </div>
          <div className={`nav-item ${activeTab === 'library' ? 'active' : ''}`} onClick={() => setActiveTab('library')}>
            <CheckSquare size={18} className="nav-icon" />
            <span>Library</span>
          </div>
        </div>

        <div className="sidebar-profile">
          <div className="profile-info">
            <div className="profile-avatar">
              <UserCircle size={22} />
            </div>
            <div>
              <div style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 500 }}>{status?.activeUser?.personaName || 'Steam Client'}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Local Steam session</div>
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
              Local Steam activity <span className="highlight">{sessions.length} games running.</span>
            </div>
          </div>

          <div className="top-search-wrap">
            <div className="search-box search-box-top">
              <Search className="search-icon" />
              <input type="text" placeholder="Search games or AppID..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              {searchQuery && (
                <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setSearchQuery('')}>
                  <X size={12} />
                </button>
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
              <span className="stat-value">{sessions.length} <span style={{fontSize:'0.9rem', color:'var(--text-dim)', fontWeight:'normal'}}>/ 32</span></span>
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

        {/* Games Section */}
        <div className="section-header">
          <div className="section-title">
            Games <span className="badge">{sessions.length} Running</span>
          </div>
        </div>

        {/* Games Grid */}
        <div className="games-grid">
          {pagedGames.map(game => {
            const isRunning = activeSessionMap.has(game.appid);
            const session = activeSessionMap.get(game.appid);
            
            return (
              <div key={game.appid} className="game-card">
                <div className="game-image-container">
                  <img src={game.headerImage} alt={game.name} className="game-image" onError={(e) => { e.target.src = 'https://store.cloudflare.steamstatic.com/public/images/v6/logo_steam.svg'; e.target.style.objectFit = 'contain'; }} />
                  <div className="game-gradient"></div>
                </div>
                <div className="game-info">
                  <div className="game-title" title={game.name}>{game.name}</div>
                  
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
                    {isRunning ? 'Running Active' : (game.installed ? 'Ready: Installed' : (game.source === 'history' ? 'Ready: Play History' : 'Steam Store'))}
                  </div>

                  {isRunning ? (
                    <button className="manage-btn active" onClick={(e) => { e.stopPropagation(); handleStopRun(game.appid); }}>Stop</button>
                  ) : (
                    <button className="manage-btn" onClick={(e) => { e.stopPropagation(); handleStartRun(game.appid, game.name); }}>Start</button>
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
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Showing {pageStart}&ndash;{pageEnd} of {filteredGames.length} games</span>
          </div>
        )}
      </main>

      {/* RIGHT SIDEBAR */}
      <aside className="sidebar-right">
        <div className="panel-card">
          <div className="panel-header">
            Current Session
            <Activity size={16} color="var(--accent-teal)" />
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

        <div className="panel-header" style={{ marginBottom: '12px', padding: '0 4px' }}>
          <span>Task Queue</span>
          <span className="badge" style={{ fontSize: '0.65rem' }}>{sessions.length}</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sessions.map((s) => (
            <div key={s.appId} className="task-item">
              <div className="task-icon-box">
                <Gamepad2 size={16} color="var(--accent-teal)" />
              </div>
              <div className="task-text">
                <div className="task-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
                  {s.gameName}
                </div>
                <div className="task-sub">Running active</div>
              </div>
              <div className="task-elapsed">
                {formatTimer(s.elapsedSeconds || 0)}
              </div>
              <button className="task-remove-btn" aria-label={`Remove ${s.gameName} from task list`} onClick={(e) => { e.stopPropagation(); handleStopRun(s.appId); }}>
                <X size={11} />
              </button>
            </div>
          ))}
          {sessions.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.8rem', padding: '20px 0' }}>
              No active tasks in queue
            </div>
          )}
        </div>
        
      </aside>
    </div>
  );
}
