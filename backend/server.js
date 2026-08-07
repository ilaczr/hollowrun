import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = 3824;

app.use(cors());
app.use(express.json());

// ===================================================================
// KEYAUTH CONFIG & AUTHENTICATION MIDDLEWARE
// ===================================================================
let isAuthenticated = process.env.BYPASS_KEYAUTH === 'true';
let keyAuthSessionId = null;

const KEYAUTH_API = 'https://keyauth.win/api/1.2/';

async function initKeyAuth() {
    if (isAuthenticated) return true;
    try {
        const params = new URLSearchParams();
        params.append('type', 'init');
        params.append('ver', process.env.KEYAUTH_VERSION || '1.0');
        params.append('name', process.env.KEYAUTH_APP_NAME || '');
        params.append('ownerid', process.env.KEYAUTH_OWNER_ID || '');

        const response = await fetch(KEYAUTH_API, { method: 'POST', body: params });
        const data = await response.json();
        
        if (data.success) {
            keyAuthSessionId = data.sessionid;
            return true;
        } else {
            console.error('KeyAuth Init Failed:', data.message);
            return false;
        }
    } catch (err) {
        console.error('KeyAuth request error:', err);
        return false;
    }
}

app.post('/api/auth/login', async (req, res) => {
    if (isAuthenticated) return res.json({ success: true, message: 'Already authenticated' });

    const { loginType, licenseKey, username, password } = req.body;
    
    if (loginType === 'license' && !licenseKey) {
        return res.status(400).json({ success: false, error: 'License key is required' });
    }
    if (loginType === 'userpass' && (!username || !password)) {
        return res.status(400).json({ success: false, error: 'Username and password are required' });
    }

    if (!keyAuthSessionId) {
        const initialized = await initKeyAuth();
        if (!initialized) return res.status(500).json({ success: false, error: 'Failed to initialize KeyAuth' });
    }

    try {
        const params = new URLSearchParams();
        
        if (loginType === 'license') {
            params.append('type', 'license');
            params.append('key', licenseKey);
        } else {
            params.append('type', 'login');
            params.append('username', username);
            params.append('pass', password);
        }

        params.append('sessionid', keyAuthSessionId);
        params.append('name', process.env.KEYAUTH_APP_NAME || '');
        params.append('ownerid', process.env.KEYAUTH_OWNER_ID || '');

        const response = await fetch(KEYAUTH_API, { method: 'POST', body: params });
        const data = await response.json();

        if (data.success) {
            isAuthenticated = true;
            return res.json({ success: true, message: 'Successfully authenticated!' });
        } else {
            return res.status(401).json({ success: false, error: data.message || 'Invalid credentials' });
        }
    } catch (err) {
        return res.status(500).json({ success: false, error: 'Internal server error during authentication' });
    }
});

app.get('/api/auth/status', (req, res) => {
    res.json({ authenticated: isAuthenticated });
});

// Middleware to protect API routes
const requireAuth = (req, res, next) => {
    if (req.path.startsWith('/api/auth')) return next(); // allow auth routes
    if (!isAuthenticated) return res.status(401).json({ success: false, error: 'Unauthorized: KeyAuth License Required' });
    next();
};

app.use('/api', requireAuth);

// Serve compiled static frontend from dist folder
const distPath = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// ===================================================================
// STEAM GAME INFO CACHE
// Fetches real game metadata from Steam Store API and caches to disk
// ===================================================================
const CACHE_FILE = path.join(__dirname, 'game_info_cache.json');
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
let gameInfoCache = {};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      gameInfoCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) { gameInfoCache = {}; }
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(gameInfoCache, null, 2), 'utf8');
  } catch (e) {}
}

loadCache();

// Fetch game details from Steam Store API (public, no key needed)
async function fetchSteamGameInfo(appId) {
  const cached = gameInfoCache[appId];
  if (cached && (Date.now() - cached._cachedAt) < CACHE_MAX_AGE_MS) {
    return cached;
  }

  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`;
    const response = await fetch(url);
    if (!response.ok) return cached || null;

    const data = await response.json();
    const entry = data[String(appId)];

    if (!entry || !entry.success || !entry.data) return cached || null;

    const d = entry.data;
    const info = {
      appid: appId,
      name: d.name || `AppID ${appId}`,
      type: d.type || 'unknown',
      shortDescription: d.short_description || '',
      developers: d.developers || [],
      publishers: d.publishers || [],
      genres: (d.genres || []).map(g => g.description),
      categories: (d.categories || []).map(c => c.description),
      hasTradingCards: (d.categories || []).some(c => c.id === 29),
      hasAchievements: (d.categories || []).some(c => c.id === 22),
      metacritic: d.metacritic ? d.metacritic.score : null,
      releaseDate: d.release_date ? d.release_date.date : null,
      isFree: d.is_free || false,
      price: d.price_overview ? (d.price_overview.final / 100).toFixed(2) : (d.is_free ? 'Free' : null),
      headerImage: d.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
      backgroundImage: d.background_raw || d.background || null,
      capsuleImage: d.capsule_image || null,
      website: d.website || null,
      supportedLanguages: d.supported_languages ? d.supported_languages.replace(/<[^>]*>/g, '').substring(0, 200) : null,
      platforms: d.platforms || {},
      _cachedAt: Date.now()
    };

    gameInfoCache[appId] = info;
    saveCache();
    return info;
  } catch (e) {
    return cached || null;
  }
}

// Batch fetch game info for multiple AppIDs (rate-limited to avoid hammering Steam)
async function batchFetchGameInfo(appIds) {
  const results = {};
  const toFetch = [];

  for (const id of appIds) {
    const cached = gameInfoCache[id];
    if (cached && (Date.now() - cached._cachedAt) < CACHE_MAX_AGE_MS) {
      results[id] = cached;
    } else {
      toFetch.push(id);
    }
  }

  // Fetch uncached games sequentially with a small delay to be polite
  for (const id of toFetch) {
    const info = await fetchSteamGameInfo(id);
    if (info) results[id] = info;
    // Small delay between API calls
    await new Promise(r => setTimeout(r, 250));
  }

  return results;
}

// ===================================================================
// PLAYTIME PARSER - localconfig.vdf
// ===================================================================
function parsePlaytimeData(steamPath) {
  const playtimeMap = new Map(); // appId -> { playtimeMinutes, lastPlayed }
  if (!steamPath) return playtimeMap;

  const userdataDir = path.join(steamPath, 'userdata');
  if (!fs.existsSync(userdataDir)) return playtimeMap;

  try {
    const userFolders = fs.readdirSync(userdataDir);
    for (const uFolder of userFolders) {
      const configPath = path.join(userdataDir, uFolder, 'config', 'localconfig.vdf');
      if (!fs.existsSync(configPath)) continue;

      try {
        const content = fs.readFileSync(configPath, 'utf8');
        const lines = content.split('\n');

        let currentAppId = null;
        let inAppsBlock = false;
        let braceDepth = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();

          // Detect entry into the "apps" block
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
            if (braceDepth === 1) {
              currentAppId = null;
            }
            if (braceDepth === 0) {
              inAppsBlock = false;
            }
            continue;
          }

          // App ID lines at depth 1 within apps block
          if (braceDepth === 1) {
            const idMatch = line.match(/^"(\d+)"$/);
            if (idMatch) {
              currentAppId = parseInt(idMatch[1], 10);
              if (!playtimeMap.has(currentAppId)) {
                playtimeMap.set(currentAppId, { playtimeMinutes: 0, lastPlayed: 0 });
              }
            }
          }

          // KV pairs inside an app block
          if (braceDepth === 2 && currentAppId != null) {
            const kvMatch = line.match(/^"([^"]+)"\s+"([^"]+)"$/);
            if (kvMatch) {
              const key = kvMatch[1];
              const val = kvMatch[2];
              const entry = playtimeMap.get(currentAppId);

              if (key === 'Playtime' || key === 'playtime') {
                entry.playtimeMinutes = parseInt(val, 10) || 0;
              } else if (key === 'PlaytimeDisconnected') {
                entry.playtimeMinutes += parseInt(val, 10) || 0;
              } else if (key === 'LastPlayed' || key === 'lastplayed') {
                entry.lastPlayed = parseInt(val, 10) || 0;
              }
            }
          }
        }
      } catch (e) {}
    }
  } catch (e) {}

  return playtimeMap;
}

// ===================================================================
// PRESETS CATALOG
// ===================================================================
const POPULAR_PRESETS = [
  { appid: 730, name: "Counter-Strike 2", category: "Popular" },
  { appid: 440, name: "Team Fortress 2", category: "Popular" },
  { appid: 570, name: "Dota 2", category: "Popular" },
  { appid: 252490, name: "Rust", category: "Popular" },
  { appid: 578080, name: "PUBG: BATTLEGROUNDS", category: "Popular" },
  { appid: 1172470, name: "Apex Legends", category: "Popular" },
  { appid: 105600, name: "Terraria", category: "Popular" },
  { appid: 431960, name: "Wallpaper Engine", category: "Tools" },
  { appid: 271590, name: "Grand Theft Auto V", category: "Popular" },
  { appid: 1091500, name: "Cyberpunk 2077", category: "RPG" },
  { appid: 1245620, name: "ELDEN RING", category: "RPG" },
  { appid: 1623730, name: "Palworld", category: "Survival" },
  { appid: 1086940, name: "Baldur's Gate 3", category: "RPG" },
  { appid: 550, name: "Left 4 Dead 2", category: "FPS" },
  { appid: 218620, name: "PAYDAY 2", category: "Action" },
  { appid: 4000, name: "Garry's Mod", category: "Sandbox" },
  { appid: 252950, name: "Rocket League", category: "Sports" },
  { appid: 292030, name: "The Witcher 3: Wild Hunt", category: "RPG" },
  { appid: 359550, name: "Tom Clancy's Rainbow Six Siege", category: "FPS" },
  { appid: 1085660, name: "Destiny 2", category: "FPS" },
  { appid: 381210, name: "Dead by Daylight", category: "Horror" },
  { appid: 230410, name: "Warframe", category: "Action" },
  { appid: 227300, name: "Euro Truck Simulator 2", category: "Simulation" },
  { appid: 1158310, name: "Phasmophobia", category: "Horror" },
  { appid: 945360, name: "Among Us", category: "Casual" },
  { appid: 304930, name: "Unturned", category: "Survival" },
  { appid: 413150, name: "Stardew Valley", category: "Simulation" },
  { appid: 582010, name: "Monster Hunter: World", category: "Action" },
  { appid: 553850, name: "HELLDIVERS™ 2", category: "Action" },
  { appid: 377160, name: "Fallout 4", category: "RPG" },
  { appid: 489830, name: "The Elder Scrolls V: Skyrim Special Edition", category: "RPG" },
  { appid: 892970, name: "Valheim", category: "Survival" },
  { appid: 1145360, name: "Hades", category: "Action" },
  { appid: 367520, name: "Hollow Knight", category: "Action" },
  { appid: 548430, name: "Deep Rock Galactic", category: "FPS" },
  { appid: 250900, name: "The Binding of Isaac: Rebirth", category: "Indie" },
  { appid: 588650, name: "Dead Cells", category: "Action" },
  { appid: 294100, name: "RimWorld", category: "Strategy" },
  { appid: 427520, name: "Factorio", category: "Strategy" },
  { appid: 526870, name: "Satisfactory", category: "Simulation" },
  { appid: 264710, name: "Subnautica", category: "Survival" },
  { appid: 1604030, name: "V Rising", category: "Action" },
  { appid: 1942630, name: "Lethal Company", category: "Horror" },
  { appid: 2881650, name: "Content Warning", category: "Horror" },
  { appid: 1366530, name: "Manor Lords", category: "Strategy" },
  { appid: 480, name: "Spacewar (Developer Test)", category: "Preset" },
];

// In-memory sessions store
const activeSessions = new Map();

// File path for custom user games
const CUSTOM_GAMES_FILE = path.join(__dirname, 'custom_games.json');

function loadCustomGames() {
  try {
    if (fs.existsSync(CUSTOM_GAMES_FILE)) {
      return JSON.parse(fs.readFileSync(CUSTOM_GAMES_FILE, 'utf8'));
    }
  } catch (err) {}
  return [];
}

function saveCustomGames(games) {
  try {
    fs.writeFileSync(CUSTOM_GAMES_FILE, JSON.stringify(games, null, 2), 'utf8');
  } catch (err) {}
}

// ===================================================================
// STEAM PATH & USER DETECTION
// ===================================================================
function getSteamPath() {
  try {
    const cmd = `powershell -Command "Get-ItemProperty -Path 'HKCU:\\Software\\Valve\\Steam' -Name 'SteamPath' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty SteamPath"`;
    const output = execSync(cmd, { encoding: 'utf8' }).trim();
    if (output && fs.existsSync(output)) {
      return path.normalize(output);
    }
  } catch (e) {}

  const defaultPaths = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', 'D:\\Steam'];
  for (const p of defaultPaths) {
    if (fs.existsSync(p)) return p;
  }
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

    const active = users.find(u => u.MostRecent === '1') || users[0];
    if (active) {
      return {
        steamId: active.steamId,
        personaName: active.PersonaName || active.AccountName || 'Steam User',
        accountName: active.AccountName || '',
        mostRecent: active.MostRecent === '1'
      };
    }
  } catch (err) {}
  return null;
}

// ===================================================================
// LIBRARY SCANNER - Installed games + user history + playtime
// ===================================================================
function scanFullLibrary(steamPath) {
  const gamesMap = new Map();
  if (!steamPath) return [];

  // 1. Scan installed game manifests
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
              if (appId > 0 && kv.name !== 'Steamworks Common Redistributables') {
                gamesMap.set(appId, {
                  appid: appId,
                  name: kv.name,
                  installdir: kv.installdir || '',
                  sizeBytes: parseInt(kv.SizeOnDisk || '0', 10),
                  installed: true,
                  source: 'installed'
                });
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  // 2. Parse playtime data from localconfig.vdf
  const playtimeMap = parsePlaytimeData(steamPath);
  for (const [appId, ptData] of playtimeMap) {
    if (appId <= 10) continue; // Skip Steam internal tools

    if (gamesMap.has(appId)) {
      const existing = gamesMap.get(appId);
      existing.playtimeMinutes = ptData.playtimeMinutes;
      existing.lastPlayed = ptData.lastPlayed;
      existing.lastPlayedDate = ptData.lastPlayed > 0
        ? new Date(ptData.lastPlayed * 1000).toISOString()
        : null;
    } else if (ptData.playtimeMinutes > 0 || ptData.lastPlayed > 0) {
      // Game in play history but not currently installed
      const presetMatch = POPULAR_PRESETS.find(p => p.appid === appId);
      gamesMap.set(appId, {
        appid: appId,
        name: presetMatch ? presetMatch.name : `Steam App ${appId}`,
        installed: false,
        source: 'history',
        playtimeMinutes: ptData.playtimeMinutes,
        lastPlayed: ptData.lastPlayed,
        lastPlayedDate: ptData.lastPlayed > 0
          ? new Date(ptData.lastPlayed * 1000).toISOString()
          : null
      });
    }
  }

  // 3. Add Steam CDN header image to all
  for (const [appId, game] of gamesMap) {
    game.headerImage = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
  }

  return Array.from(gamesMap.values());
}

// ===================================================================
// WORKER PROCESS MANAGEMENT
// ===================================================================
function getWorkerExecutablePath() {
  const possiblePaths = [
    path.join(__dirname, '..', 'SteamWorker', 'publish', 'SteamWorker.exe'),
    path.join(__dirname, '..', 'SteamWorker', 'bin', 'Release', 'net10.0', 'win-x64', 'SteamWorker.exe'),
    path.join(__dirname, '..', 'SteamWorker', 'bin', 'Debug', 'net10.0', 'SteamWorker.exe')
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

    const workerExe = getWorkerExecutablePath();
    if (!workerExe) {
      return resolve({ success: false, error: 'SteamWorker.exe not found. Compile the SteamWorker project first.' });
    }

    const workerDir = path.join(__dirname, 'workers', `app_${appId}`);
    if (!fs.existsSync(workerDir)) fs.mkdirSync(workerDir, { recursive: true });

    const exeDir = path.dirname(workerExe);
    for (const f of ['SteamWorker.exe', 'SteamWorker.dll', 'SteamWorker.deps.json', 'SteamWorker.runtimeconfig.json', 'Facepunch.Steamworks.Win64.dll', 'steam_api64.dll']) {
      const src = path.join(exeDir, f);
      const dst = path.join(workerDir, f);
      if (fs.existsSync(src)) {
        try { fs.copyFileSync(src, dst); } catch (e) {}
      }
    }

    let child;
    try {
      child = spawn(path.join(workerDir, 'SteamWorker.exe'), [appId.toString()], {
        cwd: workerDir,
        env: { ...process.env, SteamAppId: appId.toString(), SteamGameId: appId.toString() }
      });
    } catch (err) {
      return resolve({ success: false, error: `Failed to spawn process: ${err.message}` });
    }

    const sessionData = {
      appId, gameName: gameName || `AppID ${appId}`, process: child,
      startTime: Date.now(), personaName: '', steamId: '', status: 'STARTING', workerDir
    };
    activeSessions.set(appId, sessionData);

    let resolved = false;
    child.stdout.on('data', (data) => {
      for (const line of data.toString().trim().split('\n')) {
        try {
          const json = JSON.parse(line.trim());
          if (json.status === 'IDLING' && json.success) {
            sessionData.status = 'IDLING';
            sessionData.personaName = json.personaName || '';
            sessionData.steamId = json.steamId || '';
            if (!resolved) { resolved = true; resolve({ success: true, session: getSessionInfo(sessionData) }); }
          } else if (json.success === false && !resolved) {
            resolved = true; stopIdleSession(appId);
            resolve({ success: false, error: json.error || 'Failed to initialize' });
          }
        } catch (e) {}
      }
    });
    child.stderr.on('data', (data) => console.error(`[Worker ${appId}]:`, data.toString()));
    child.on('exit', (code) => {
      activeSessions.delete(appId);
      if (!resolved) { resolved = true; resolve({ success: false, error: `Worker exited with code ${code}` }); }
    });
  });
}

function stopIdleSession(appId) {
  if (!activeSessions.has(appId)) return { success: false, message: 'Not running' };
  const session = activeSessions.get(appId);
  try {
    if (session.process && !session.process.killed) {
      session.process.kill('SIGINT');
      setTimeout(() => { try { if (!session.process.killed) session.process.kill('SIGKILL'); } catch(e){} }, 1000);
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
    headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${session.appId}/header.jpg`
  };
}

// ===================================================================
// API ENDPOINTS
// ===================================================================

// Status
app.get('/api/status', (req, res) => {
  const steamPath = getSteamPath();
  const activeUser = getActiveSteamUser(steamPath);
  res.json({
    success: true,
    steamInstalled: !!steamPath,
    steamPath: steamPath || 'Not found',
    activeUser: activeUser || { personaName: 'Steam Client', steamId: 'N/A' },
    activeSessionsCount: activeSessions.size
  });
});

// Full Library with playtime data
app.get('/api/games', (req, res) => {
  const steamPath = getSteamPath();
  const libraryGames = scanFullLibrary(steamPath);
  const customGames = loadCustomGames();

  const knownAppIds = new Set(libraryGames.map(g => g.appid));

  const presetList = POPULAR_PRESETS.filter(p => !knownAppIds.has(p.appid)).map(p => ({
    appid: p.appid, name: p.name, installed: false,
    headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${p.appid}/header.jpg`,
    category: p.category, source: 'preset'
  }));

  const customList = customGames.filter(c => !knownAppIds.has(c.appid)).map(c => ({
    appid: c.appid, name: c.name || `AppID ${c.appid}`, installed: false,
    headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${c.appid}/header.jpg`,
    category: 'Custom', source: 'custom'
  }));

  // Library stats
  const totalPlaytime = libraryGames.reduce((sum, g) => sum + (g.playtimeMinutes || 0), 0);
  const installedCount = libraryGames.filter(g => g.installed).length;
  const historyCount = libraryGames.filter(g => g.source === 'history').length;

  res.json({
    success: true,
    installed: libraryGames,
    presets: presetList,
    custom: customList,
    libraryStats: {
      totalGames: libraryGames.length,
      installedGames: installedCount,
      historyGames: historyCount,
      totalPlaytimeMinutes: totalPlaytime,
      totalPlaytimeHours: +(totalPlaytime / 60).toFixed(1)
    }
  });
});

// Fetch detailed Steam info for a specific game
app.get('/api/game-info/:appid', async (req, res) => {
  const appId = parseInt(req.params.appid, 10);
  if (isNaN(appId)) return res.status(400).json({ success: false, error: 'Invalid AppID' });

  const info = await fetchSteamGameInfo(appId);
  if (!info) return res.json({ success: false, error: 'Could not fetch game info from Steam' });
  res.json({ success: true, gameInfo: info });
});

// Batch enrich multiple games with Steam metadata
app.post('/api/enrich-games', async (req, res) => {
  const { appids } = req.body;
  if (!appids || !Array.isArray(appids) || appids.length === 0) {
    return res.status(400).json({ success: false, error: 'Provide an array of appids' });
  }

  // Limit to 20 per batch request
  const limited = appids.slice(0, 20).map(id => parseInt(id, 10)).filter(id => !isNaN(id));
  const enriched = await batchFetchGameInfo(limited);
  res.json({ success: true, games: enriched });
});

// Steam Store live search
app.get('/api/search-steam-store', async (req, res) => {
  const query = req.query.q || '';
  if (!query || query.length < 2) return res.json({ success: true, results: [] });

  try {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`;
    const response = await fetch(url);
    if (!response.ok) return res.json({ success: false, error: 'Steam Store API error' });
    const data = await response.json();
    const results = (data.items || []).map(item => ({
      appid: item.id, name: item.name,
      headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/header.jpg`,
      price: item.price ? (item.price.final / 100).toFixed(2) : 'Free',
      category: 'Steam Store Search'
    }));
    res.json({ success: true, results });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Sessions
app.get('/api/sessions', (req, res) => {
  res.json({ success: true, sessions: Array.from(activeSessions.values()).map(getSessionInfo) });
});

// Start Idle
app.post('/api/idle/start', async (req, res) => {
  const { appid, appids, name } = req.body;
  const targetIds = appids || (appid ? [appid] : []);
  if (targetIds.length === 0) return res.status(400).json({ success: false, error: 'No AppID specified' });

  const results = [];
  for (const id of targetIds) {
    const numId = parseInt(id, 10);
    results.push({ appid: numId, ...(await startIdleSession(numId, name)) });
  }
  res.json({ success: true, results });
});

// Stop Idle
app.post('/api/idle/stop', (req, res) => {
  const { appid } = req.body;
  if (!appid) return res.status(400).json({ success: false, error: 'No AppID' });
  res.json(stopIdleSession(parseInt(appid, 10)));
});

// Stop All
app.post('/api/idle/stop-all', (req, res) => {
  const stopped = [];
  for (const appId of Array.from(activeSessions.keys())) { stopIdleSession(appId); stopped.push(appId); }
  res.json({ success: true, stoppedCount: stopped.length, stoppedAppIds: stopped });
});

// Add Custom Game
app.post('/api/custom-game', (req, res) => {
  const { appid, name } = req.body;
  if (!appid || isNaN(appid)) return res.status(400).json({ success: false, error: 'Valid AppID required' });
  const numAppId = parseInt(appid, 10);
  const custom = loadCustomGames();
  if (!custom.some(c => c.appid === numAppId)) { custom.push({ appid: numAppId, name: name || `AppID ${numAppId}` }); saveCustomGames(custom); }
  res.json({ success: true, appid: numAppId, name: name || `AppID ${numAppId}` });
});

// SPA fallback
app.get('*', (req, res) => {
  if (fs.existsSync(path.join(distPath, 'index.html'))) {
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    res.send('Steam Idler Backend active. Frontend dist not found.');
  }
});

app.listen(PORT, async () => {
    console.log(`IdleTool server running at http://localhost:${PORT}`);
    
    if (!process.env.ELECTRON_APP) {
        try {
            const open = (await import('open')).default;
            await open(`http://localhost:${PORT}`);
        } catch (err) {
            console.log(`Failed to open browser automatically: ${err.message}`);
        }
    }
});
