import { useState, useEffect } from 'react';
import { 
  Gamepad2, LayoutDashboard, CheckSquare, UserCircle, Cloud, 
  Settings, Activity, Clock, ListChecks, Zap, Hexagon, Search,
  MoreVertical, Square, X
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

export default function App() {
  const [status, setStatus] = useState(null);
  const [games, setGames] = useState({ installed: [], presets: [], custom: [], libraryStats: null });
  const [sessions, setSessions] = useState([]);
  const [activeTab, setActiveTab] = useState('all'); // maps to Sidebar: Dashboard (all), Games (installed), Tasks (presets), etc.
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [customAppId, setCustomAppId] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const [storeSearchQuery, setStoreSearchQuery] = useState('');
  const [storeSearchResults, setStoreSearchResults] = useState([]);
  const [storeSearchLoading, setStoreSearchLoading] = useState(false);
  
  const [detailGame, setDetailGame] = useState(null);
  const [detailInfo, setDetailInfo] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [enrichedCache, setEnrichedCache] = useState({});

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
      setErrorMessage(previous => previous.startsWith('Failed to connect to the IdleTool backend:') ? '' : previous);
    } catch (err) {
      setErrorMessage(`Failed to connect to the IdleTool backend: ${err.message}`);
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

  useEffect(() => {
    if (activeTab !== 'store') return;
    const query = storeSearchQuery.trim();
    if (query.length < 2) {
      setStoreSearchResults([]);
      setStoreSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setStoreSearchLoading(true);
      try {
        const res = await requestJson(`/search-steam-store?q=${encodeURIComponent(query)}`);
        if (!cancelled) setStoreSearchResults(res.results || []);
      } catch (err) {
        if (!cancelled) setErrorMessage(`Steam Store search failed: ${err.message}`);
      } finally {
        if (!cancelled) setStoreSearchLoading(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [storeSearchQuery, activeTab]);

  const openGameDetail = async (game) => {
    setDetailGame(game);
    setDetailInfo(enrichedCache[game.appid] || null);
    setDetailLoading(true);
    try {
      const res = await requestJson(`/game-info/${game.appid}`);
      if (res.gameInfo) {
        setDetailInfo(res.gameInfo);
        setEnrichedCache(prev => ({ ...prev, [game.appid]: res.gameInfo }));
      }
    } catch (err) {
      setErrorMessage(`Could not load game details: ${err.message}`);
    }
    setDetailLoading(false);
  };

  const handleStartIdle = async (appId, name) => {
    try {
      const response = await requestJson('/idle/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appid: appId, name }) });
      const result = response.results?.[0];
      if (!result?.success) throw new Error(result?.error || 'Steam worker failed to start');
      await fetchData();
    } catch (err) {
      setErrorMessage(`Could not start AppID ${appId}: ${err.message}`);
    }
  };

  const handleStopIdle = async (appId) => {
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

  const handleAddCustomGame = async () => {
    const appId = Number(customAppId);
    if (!Number.isInteger(appId) || appId <= 0 || appId > 0xFFFFFFFF) {
      setErrorMessage('Enter a valid positive Steam AppID.');
      return;
    }

    try {
      await requestJson('/custom-game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: appId })
      });
      setCustomAppId('');
      setShowAddModal(false);
      await fetchData();
    } catch (err) {
      setErrorMessage(`Could not add AppID ${appId}: ${err.message}`);
    }
  };

  const allGames = [
    ...games.installed.map(g => ({ ...g, type: g.source || 'installed' })),
    ...games.presets.map(g => ({ ...g, type: 'preset' })),
    ...games.custom.map(g => ({ ...g, type: 'custom' }))
  ];

  const activeSessionMap = new Map(sessions.map(s => [s.appId, s]));

  const filteredGames = activeTab === 'store'
    ? storeSearchResults.map(g => ({ ...g, type: 'store' }))
    : allGames.filter(g => {
        const match = g.name.toLowerCase().includes(searchQuery.toLowerCase()) || g.appid.toString().includes(searchQuery);
        if (!match) return false;
        if (activeTab === 'installed') return g.installed;
        if (activeTab === 'history') return g.source === 'history';
        return true;
      });

  const stats = games.libraryStats || {};
  const pageTitle = {
    all: 'Dashboard',
    installed: 'Installed Games',
    history: 'Library History',
    store: 'Store Search'
  }[activeTab] || 'Dashboard';

  if (loading) {
    return <div className="loading-screen">Loading IdleTool...</div>;
  }

  return (
    <div className="app-layout">
      {/* LEFT SIDEBAR */}
      <aside className="sidebar-left">
        <div className="brand-section">
          <div className="brand-icon">
            <Gamepad2 size={20} color="#fff" />
          </div>
          <div className="brand-text-block">
            <div className="brand-title">IdleTool</div>
            <div className="brand-version">v1.0.0</div>
          </div>
        </div>

        <div className="nav-menu">
          <div className={`nav-item ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
            <LayoutDashboard size={18} className="nav-icon" />
            <span>Dashboard</span>
          </div>
          <div className={`nav-item ${activeTab === 'installed' ? 'active' : ''}`} onClick={() => setActiveTab('installed')}>
            <Gamepad2 size={18} className="nav-icon" />
            <span>Installed Games</span>
          </div>
          <div className={`nav-item ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
            <CheckSquare size={18} className="nav-icon" />
            <span>Library History</span>
          </div>
          <div className={`nav-item ${activeTab === 'store' ? 'active' : ''}`} onClick={() => setActiveTab('store')}>
            <Cloud size={18} className="nav-icon" />
            <span>Store Search</span>
          </div>
          <div className="nav-item" onClick={() => setShowAddModal(true)}>
            <Settings size={18} className="nav-icon" />
            <span>Add Custom</span>
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
          <MoreVertical size={16} color="var(--text-muted)" />
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
          <div>
            <h1 className="page-title">{pageTitle}</h1>
            <div className="page-subtitle">
              Local Steam activity <span className="highlight">{sessions.length} games running.</span>
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
              <span className="stat-subtext">Ready to idle</span>
            </div>
          </div>
        </div>

        {/* Games Section */}
        <div className="section-header">
          <div className="section-title">
            Games <span className="badge">{sessions.length} Running</span>
          </div>
          <div className="controls-group">
            <div className="search-box">
              <Search className="search-icon" />
              {activeTab === 'store' ? (
                <input type="text" placeholder="Search Steam store..." value={storeSearchQuery} onChange={(e) => setStoreSearchQuery(e.target.value)} />
              ) : (
                <input type="text" placeholder="Search games..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              )}
            </div>
          </div>
        </div>

        {/* Games Grid */}
        <div className="games-grid">
          {filteredGames.slice(0, 32).map(game => {
            const isIdling = activeSessionMap.has(game.appid);
            const session = activeSessionMap.get(game.appid);
            
            return (
              <div key={game.appid} className="game-card" onClick={() => openGameDetail(game)}>
                <div className="game-image-container">
                  <img src={game.headerImage} alt={game.name} className="game-image" onError={(e) => { e.target.src = 'https://store.cloudflare.steamstatic.com/public/images/v6/logo_steam.svg'; e.target.style.objectFit = 'contain'; }} />
                  <div className="game-gradient"></div>
                  <div className={`status-dot ${!isIdling ? 'inactive' : ''}`}></div>
                  <div style={{ position: 'absolute', top: '10px', right: '10px', color: 'rgba(255,255,255,0.7)' }}>
                    <MoreVertical size={16} />
                  </div>
                </div>
                <div className="game-info">
                  <div className="game-title" title={game.name}>{game.name}</div>
                  
                  {isIdling && session ? (
                    <div className="game-timer">
                      <Clock size={12} /> {formatTimer(session.elapsedSeconds || 0)}
                    </div>
                  ) : (
                    <div className="game-timer">
                      <Clock size={12} /> {game.playtimeMinutes ? formatPlaytime(game.playtimeMinutes) : 'Not played'}
                    </div>
                  )}

                  <div className="game-subtext">
                    {isIdling ? 'Idling Active' : (game.installed ? 'Ready: Installed' : (game.source === 'history' ? 'Ready: Play History' : 'Steam Store'))}
                  </div>

                  {isIdling ? (
                    <button className="manage-btn active" onClick={(e) => { e.stopPropagation(); handleStopIdle(game.appid); }}>Stop</button>
                  ) : (
                    <button className="manage-btn" onClick={(e) => { e.stopPropagation(); handleStartIdle(game.appid, game.name); }}>Start</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        
        {activeTab === 'store' && storeSearchLoading && (
          <div className="empty-state">Searching the Steam Store...</div>
        )}

        {filteredGames.length > 32 && (
          <div className="footer-actions">
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Showing 32 of {filteredGames.length} games</span>
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
          
          <button className="stop-all-btn" onClick={handleStopAll}>
            <Square size={16} fill="currentColor" /> Stop All
          </button>
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
                <div className="task-sub">Idling active</div>
              </div>
              <div className="task-elapsed">
                {formatTimer(s.elapsedSeconds || 0)}
              </div>
            </div>
          ))}
          {sessions.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.8rem', padding: '20px 0' }}>
              No active tasks in queue
            </div>
          )}
        </div>
        
      </aside>
      
      {/* Detail Modal */}
      {detailGame && (
        <div className="modal-overlay" onClick={() => { setDetailGame(null); setDetailInfo(null); }}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize: '1.15rem', color: '#fff' }}>{detailGame.name}</h2>
              <X size={20} color="var(--text-muted)" style={{ cursor: 'pointer' }} onClick={() => { setDetailGame(null); setDetailInfo(null); }} />
            </div>
            <img src={detailGame.headerImage} alt={detailGame.name} style={{ width: '100%', borderRadius: '10px', marginBottom: '16px' }} />
            
            {detailLoading && !detailInfo && (
              <div className="empty-state">Loading game details...</div>
            )}

            {detailInfo && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '10px' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Developer</div>
                    <div style={{ fontSize: '0.88rem', color: '#fff', marginTop: '2px' }}>{detailInfo.developers?.join(', ') || 'Unknown'}</div>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '10px' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Price</div>
                    <div style={{ fontSize: '0.88rem', color: '#fff', marginTop: '2px' }}>{detailInfo.isFree ? 'Free to Play' : (detailInfo.price ? `$${detailInfo.price}` : 'N/A')}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
                  {activeSessionMap.has(detailGame.appid) ? (
                    <button className="manage-btn active" style={{ width: 'auto', padding: '8px 24px' }} onClick={() => { handleStopIdle(detailGame.appid); setDetailGame(null); }}>Stop Idling</button>
                  ) : (
                    <button className="stop-all-btn" style={{ width: 'auto', padding: '8px 24px' }} onClick={() => { handleStartIdle(detailGame.appid, detailGame.name); setDetailGame(null); }}>Start Idling</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Add Custom Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize: '1.15rem', color: '#fff' }}>Add Custom Steam AppID</h2>
              <X size={20} color="var(--text-muted)" style={{ cursor: 'pointer' }} onClick={() => setShowAddModal(false)} />
            </div>
            <div className="form-group">
              <input type="number" min="1" max="4294967295" step="1" className="form-input" placeholder="AppID (e.g. 730)" value={customAppId} onChange={e => setCustomAppId(e.target.value)} />
            </div>
            <button className="stop-all-btn" onClick={handleAddCustomGame}>Add Game</button>
          </div>
        </div>
      )}
    </div>
  );
}
