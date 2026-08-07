import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Gamepad2, LayoutDashboard, CheckSquare, UserCircle, Cloud, 
  BarChart3, FileText, Settings, Activity, Clock, ListChecks, 
  RotateCw, Zap, Hexagon, Search, Filter, Grid, List, MoreVertical,
  Minus, Square, X, Check
} from 'lucide-react';
import Login from './Login';

const API_BASE = 'http://localhost:3824/api';

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

function formatLastPlayed(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  const now = new Date();
  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [games, setGames] = useState({ installed: [], presets: [], custom: [], libraryStats: null });
  const [sessions, setSessions] = useState([]);
  const [activeTab, setActiveTab] = useState('all'); // maps to Sidebar: Dashboard (all), Games (installed), Tasks (presets), etc.
  const [searchQuery, setSearchQuery] = useState('');
  const [autoStopHours, setAutoStopHours] = useState('off');
  const [showAddModal, setShowAddModal] = useState(false);
  const [customAppId, setCustomAppId] = useState('');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const [storeSearchQuery, setStoreSearchQuery] = useState('');
  const [storeSearchResults, setStoreSearchResults] = useState([]);
  const [storeSearchLoading, setStoreSearchLoading] = useState(false);
  
  const [detailGame, setDetailGame] = useState(null);
  const [detailInfo, setDetailInfo] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [enrichedCache, setEnrichedCache] = useState({});

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/auth/status`)
      .then(res => res.json())
      .then(data => {
        setIsAuthenticated(data.authenticated);
        setIsLoadingAuth(false);
      })
      .catch(() => setIsLoadingAuth(false));
  }, []);

  const addLog = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [{ time, msg, type }, ...prev.slice(0, 10)]);
  };

  const fetchData = async () => {
    try {
      const [statusRes, gamesRes, sessionsRes] = await Promise.all([
        fetch(`${API_BASE}/status`).then(r => r.json()),
        fetch(`${API_BASE}/games`).then(r => r.json()),
        fetch(`${API_BASE}/sessions`).then(r => r.json())
      ]);
      if (statusRes.success) setStatus(statusRes);
      if (gamesRes.success) setGames(gamesRes);
      if (sessionsRes.success) setSessions(sessionsRes.sessions || []);
    } catch (err) {
      addLog(`Failed to connect to backend: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSessions(prev => prev.map(s => ({ ...s, elapsedSeconds: s.elapsedSeconds + 1 })));
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (games.installed.length === 0) return;
    const idsToEnrich = games.installed.filter(g => !enrichedCache[g.appid]).map(g => g.appid).slice(0, 15);
    if (idsToEnrich.length === 0) return;
    fetch(`${API_BASE}/enrich-games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appids: idsToEnrich }) })
      .then(r => r.json())
      .then(data => { if (data.success && data.games) setEnrichedCache(prev => ({ ...prev, ...data.games })); })
      .catch(() => {});
  }, [games.installed.length]);

  const doStoreSearch = useCallback(
    debounce(async (query) => {
      if (!query || query.length < 2) { setStoreSearchResults([]); setStoreSearchLoading(false); return; }
      setStoreSearchLoading(true);
      try {
        const res = await fetch(`${API_BASE}/search-steam-store?q=${encodeURIComponent(query)}`).then(r => r.json());
        if (res.success) setStoreSearchResults(res.results || []);
      } catch (err) {}
      finally { setStoreSearchLoading(false); }
    }, 400),
    []
  );

  useEffect(() => {
    if (activeTab === 'store') doStoreSearch(storeSearchQuery);
  }, [storeSearchQuery, activeTab]);

  const openGameDetail = async (game) => {
    setDetailGame(game);
    setDetailInfo(enrichedCache[game.appid] || null);
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_BASE}/game-info/${game.appid}`).then(r => r.json());
      if (res.success && res.gameInfo) {
        setDetailInfo(res.gameInfo);
        setEnrichedCache(prev => ({ ...prev, [game.appid]: res.gameInfo }));
      }
    } catch (err) {}
    setDetailLoading(false);
  };

  const handleStartIdle = async (appId, name) => {
    addLog(`Initiating Steam IPC for AppID ${appId}...`, 'info');
    try {
      await fetch(`${API_BASE}/idle/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appid: appId, name }) });
      fetchData();
    } catch (err) {}
  };

  const handleStopIdle = async (appId) => {
    try {
      await fetch(`${API_BASE}/idle/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appid: appId }) });
      fetchData();
    } catch (err) {}
  };

  const handleStopAll = async () => {
    try {
      await fetch(`${API_BASE}/idle/stop-all`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      fetchData();
    } catch (err) {}
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
        if (activeTab === 'store') return g.type === 'store';
        return true;
      });

  const totalElapsedSecs = sessions.reduce((acc, s) => acc + (s.elapsedSeconds || 0), 0);
  const stats = games.libraryStats || {};

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-[#0e1219] flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLoginSuccess={() => setIsAuthenticated(true)} />;
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
            <div className="brand-version">v2.4.1</div>
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
              <div style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 500 }}>{status?.activeUser?.personaName || 'Idler Pro'}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Premium Plan</div>
            </div>
          </div>
          <MoreVertical size={16} color="var(--text-muted)" />
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="main-content">
        <header className="main-header">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <div className="page-subtitle">
              Welcome back, Idler! <span className="highlight">{sessions.length} games running.</span>
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
              <span className="stat-value">{(stats.totalGames/1000).toFixed(2)}K</span>
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
            <button className="icon-btn"><Filter size={16} /> Filter</button>
            <button className="icon-btn"><Grid size={16} /></button>
            <button className="icon-btn"><List size={16} /></button>
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
                    <button className="manage-btn" onClick={(e) => { e.stopPropagation(); handleStartIdle(game.appid, game.name); }}>Manage</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        
        {filteredGames.length > 32 && (
          <div className="footer-actions">
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Showing 32 of {filteredGames.length} games</span>
            <button className="manage-btn" style={{ width: 'auto', padding: '6px 16px' }}>View All Games</button>
          </div>
        )}
      </main>

      {/* RIGHT SIDEBAR */}
      <aside className="sidebar-right">
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginBottom: '24px', color: 'var(--text-muted)' }}>
          <Minus size={16} style={{ cursor: 'pointer' }} />
          <Square size={14} style={{ cursor: 'pointer' }} />
          <X size={16} style={{ cursor: 'pointer' }} />
        </div>

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
              <div className="session-stat-val">{sessions.length * 2}</div>
            </div>
            <div className="session-stat-row">
              <div className="session-stat-lbl"><RotateCw size={14} /> Auto-stop</div>
              <div className="session-stat-val">{autoStopHours === 'off' ? 'Off' : `${autoStopHours}h`}</div>
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
          {sessions.map((s, i) => (
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
              <div className="progress-circle">
                {Math.min(100, Math.floor((s.elapsedSeconds / 7200) * 100))}%
              </div>
            </div>
          ))}
          {sessions.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.8rem', padding: '20px 0' }}>
              No active tasks in queue
            </div>
          )}
        </div>
        
        <button className="manage-btn" style={{ marginTop: '16px' }}>View All Tasks</button>
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
              <input type="number" className="form-input" placeholder="AppID (e.g. 730)" value={customAppId} onChange={e => setCustomAppId(e.target.value)} />
            </div>
            <button className="stop-all-btn" onClick={() => { setShowAddModal(false); /* connect handleAddCustom logic */ }}>Add Game</button>
          </div>
        </div>
      )}
    </div>
  );
}
