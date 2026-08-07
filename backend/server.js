import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { MAX_IDLE_SESSIONS, normalizeGameName, parseAppId } from './validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const HOST = '127.0.0.1';
const PORT = 3824;
const BASE_URL = `http://${HOST}:${PORT}`;
const rawInstanceToken = process.env.IDLETOOL_INSTANCE_TOKEN || '';
const INSTANCE_TOKEN = /^[a-f0-9]{64}$/.test(rawInstanceToken) ? rawInstanceToken : null;
const ALLOWED_HOSTS = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([
  BASE_URL,
  `http://localhost:${PORT}`,
  'http://127.0.0.1:5173',
  'http://localhost:5173'
]);

app.disable('x-powered-by');

// The API controls local processes and reads local Steam metadata. Keep it
// accessible only through the local dashboard and reject DNS rebinding.
app.use((req, res, next) => {
  const host = req.get('host');
  const origin = req.get('origin');

  if (!ALLOWED_HOSTS.has(host)) {
    return res.status(403).json({ success: false, error: 'Invalid host' });
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ success: false, error: 'Invalid origin' });
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (INSTANCE_TOKEN) res.setHeader('X-IdleTool-Instance', INSTANCE_TOKEN);
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self'; img-src 'self' data: https://cdn.akamai.steamstatic.com https://store.cloudflare.steamstatic.com; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );
  next();
});

app.use(express.json({ limit: '32kb' }));

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'IdleTool/1.0' },
      signal: controller.signal
    });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

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
      const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      gameInfoCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
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
    const data = await fetchJson(url);
    if (!data) return cached || null;
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
      headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
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
      const parsed = JSON.parse(fs.readFileSync(CUSTOM_GAMES_FILE, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(game => {
          const appId = parseAppId(game?.appid);
          return appId === null ? null : { appid: appId, name: normalizeGameName(game?.name, appId) };
        })
        .filter(Boolean)
        .slice(0, 1000);
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
    const output = execFileSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { encoding: 'utf8', windowsHide: true }
    );
    const match = output.match(/SteamPath\s+REG_\w+\s+(.+)$/im);
    const registryPath = match?.[1]?.trim();
    if (registryPath && fs.existsSync(registryPath)) {
      return path.normalize(registryPath);
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
    path.join(__dirname, '..', 'IdleTool.Worker', 'publish', 'IdleTool.Worker.exe'),
    // Keep the existing prebuilt worker usable until the renamed project is rebuilt.
    path.join(__dirname, '..', 'IdleTool.Worker', 'publish', 'SteamWorker.exe'),
    path.join(__dirname, '..', 'IdleTool.Worker', 'bin', 'Release', 'net10.0', 'win-x64', 'IdleTool.Worker.exe'),
    path.join(__dirname, '..', 'IdleTool.Worker', 'bin', 'Debug', 'net10.0', 'IdleTool.Worker.exe')
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
    if (activeSessions.size >= MAX_IDLE_SESSIONS) {
      return resolve({ success: false, error: `At most ${MAX_IDLE_SESSIONS} games can be idled at once.` });
    }

    const workerExe = getWorkerExecutablePath();
    if (!workerExe) {
      return resolve({ success: false, error: 'IdleTool worker not found. Build the IdleTool.Worker project first.' });
    }

    const workerDir = path.join(__dirname, 'workers', `app_${appId}`);
    if (!fs.existsSync(workerDir)) fs.mkdirSync(workerDir, { recursive: true });

    const exeDir = path.dirname(workerExe);
    const workerExecutableName = path.basename(workerExe);
    const workerBaseName = path.basename(workerExe, path.extname(workerExe));
    const workerFiles = [
      workerExecutableName,
      `${workerBaseName}.dll`,
      `${workerBaseName}.deps.json`,
      `${workerBaseName}.runtimeconfig.json`,
      'Facepunch.Steamworks.Win64.dll',
      'steam_api64.dll'
    ];
    for (const f of workerFiles) {
      const src = path.join(exeDir, f);
      const dst = path.join(workerDir, f);
      if (fs.existsSync(src)) {
        try { fs.copyFileSync(src, dst); } catch (e) {}
      }
    }

    let child;
    try {
      child = spawn(path.join(workerDir, workerExecutableName), [appId.toString()], {
        cwd: workerDir,
        env: { ...process.env, SteamAppId: appId.toString(), SteamGameId: appId.toString() },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (err) {
      return resolve({ success: false, error: `Failed to spawn process: ${err.message}` });
    }

    const sessionData = {
      appId, gameName: normalizeGameName(gameName, appId), process: child,
      startTime: Date.now(), personaName: '', steamId: '', status: 'STARTING', workerDir
    };
    activeSessions.set(appId, sessionData);

    let resolved = false;
    let stdoutBuffer = '';
    const finishStart = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(startupTimeout);
      resolve(result);
    };
    const startupTimeout = setTimeout(() => {
      stopIdleSession(appId);
      finishStart({ success: false, error: 'Steam worker timed out while starting.' });
    }, 15000);

    const processWorkerMessage = (line) => {
      if (!line) return;
      try {
        const json = JSON.parse(line);
        if (json.status === 'IDLING' && json.success) {
          sessionData.status = 'IDLING';
          sessionData.personaName = typeof json.personaName === 'string' ? json.personaName.slice(0, 100) : '';
          sessionData.steamId = typeof json.steamId === 'string' ? json.steamId.slice(0, 32) : '';
          finishStart({ success: true, session: getSessionInfo(sessionData) });
        } else if (json.success === false) {
          stopIdleSession(appId);
          finishStart({ success: false, error: json.error || 'Failed to initialize' });
        }
      } catch (e) {
        // Ignore non-JSON diagnostics from the worker.
      }
    };

    child.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      let newlineIndex;
      while ((newlineIndex = stdoutBuffer.indexOf('\n')) >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        processWorkerMessage(line);
      }
    });

    child.stderr.on('data', (data) => console.error(`[Worker ${appId}]:`, data.toString().slice(0, 2000)));
    child.once('error', (err) => {
      activeSessions.delete(appId);
      finishStart({ success: false, error: `Worker process error: ${err.message}` });
    });
    child.on('exit', (code) => {
      processWorkerMessage(stdoutBuffer.trim());
      activeSessions.delete(appId);
      finishStart({ success: false, error: `Worker exited with code ${code}` });
    });
  });
}

function stopIdleSession(appId) {
  if (!activeSessions.has(appId)) return { success: false, message: 'Not running' };
  const session = activeSessions.get(appId);
  try {
    if (session.process && session.process.exitCode === null) {
      session.process.kill('SIGINT');
      setTimeout(() => {
        try {
          if (session.process.exitCode === null) session.process.kill('SIGKILL');
        } catch (e) {}
      }, 1000);
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
    activeUser: activeUser
      ? { personaName: activeUser.personaName, steamId: activeUser.steamId }
      : { personaName: 'Steam Client', steamId: 'N/A' },
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
  const appId = parseAppId(req.params.appid);
  if (appId === null) return res.status(400).json({ success: false, error: 'Invalid AppID' });

  const info = await fetchSteamGameInfo(appId);
  if (!info) return res.json({ success: false, error: 'Could not fetch game info from Steam' });
  res.json({ success: true, gameInfo: info });
});

// Batch enrich multiple games with Steam metadata
app.post('/api/enrich-games', async (req, res) => {
  const { appids } = req.body ?? {};
  if (!Array.isArray(appids) || appids.length === 0) {
    return res.status(400).json({ success: false, error: 'Provide an array of appids' });
  }

  // Limit to 20 per batch request
  const limited = [...new Set(appids.slice(0, 20).map(parseAppId).filter(id => id !== null))];
  if (limited.length === 0) {
    return res.status(400).json({ success: false, error: 'No valid AppIDs provided' });
  }
  const enriched = await batchFetchGameInfo(limited);
  res.json({ success: true, games: enriched });
});

// Steam Store live search
app.get('/api/search-steam-store', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (query.length < 2) return res.json({ success: true, results: [] });

  try {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`;
    const data = await fetchJson(url);
    if (!data) return res.status(502).json({ success: false, error: 'Steam Store API error' });
    const results = (Array.isArray(data.items) ? data.items : [])
      .slice(0, 50)
      .map(item => {
        const appId = parseAppId(item?.id);
        if (appId === null) return null;
        const finalPrice = Number(item?.price?.final);
        return {
          appid: appId,
          name: normalizeGameName(item?.name, appId),
          headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
          price: Number.isFinite(finalPrice) ? (finalPrice / 100).toFixed(2) : 'Free',
          category: 'Steam Store Search'
        };
      })
      .filter(Boolean);
    res.json({ success: true, results });
  } catch (err) {
    res.status(502).json({ success: false, error: 'Steam Store request failed' });
  }
});

// Sessions
app.get('/api/sessions', (req, res) => {
  res.json({ success: true, sessions: Array.from(activeSessions.values()).map(getSessionInfo) });
});

// Start Idle
app.post('/api/idle/start', async (req, res) => {
  const { appid, appids, name } = req.body ?? {};
  if (appids !== undefined && !Array.isArray(appids)) {
    return res.status(400).json({ success: false, error: 'appids must be an array' });
  }

  const requestedIds = Array.isArray(appids) ? appids : (appid !== undefined ? [appid] : []);
  if (requestedIds.length === 0) return res.status(400).json({ success: false, error: 'No AppID specified' });
  if (requestedIds.length > MAX_IDLE_SESSIONS) {
    return res.status(400).json({ success: false, error: `At most ${MAX_IDLE_SESSIONS} AppIDs can be started at once` });
  }

  const targetIds = [...new Set(requestedIds.map(parseAppId))];
  if (targetIds.includes(null)) {
    return res.status(400).json({ success: false, error: 'One or more AppIDs are invalid' });
  }

  const results = [];
  for (const appId of targetIds) {
    results.push({ appid: appId, ...(await startIdleSession(appId, name)) });
  }
  res.json({ success: true, results });
});

// Stop Idle
app.post('/api/idle/stop', (req, res) => {
  const appId = parseAppId(req.body?.appid);
  if (appId === null) return res.status(400).json({ success: false, error: 'Valid AppID required' });
  res.json(stopIdleSession(appId));
});

// Stop All
app.post('/api/idle/stop-all', (req, res) => {
  const stopped = [];
  for (const appId of Array.from(activeSessions.keys())) { stopIdleSession(appId); stopped.push(appId); }
  res.json({ success: true, stoppedCount: stopped.length, stoppedAppIds: stopped });
});

// Add Custom Game
app.post('/api/custom-game', (req, res) => {
  const { appid, name } = req.body ?? {};
  const numAppId = parseAppId(appid);
  if (numAppId === null) return res.status(400).json({ success: false, error: 'Valid AppID required' });
  const gameName = normalizeGameName(name, numAppId);
  const custom = loadCustomGames();
  if (!custom.some(c => c.appid === numAppId)) {
    custom.push({ appid: numAppId, name: gameName });
    saveCustomGames(custom);
  }
  res.json({ success: true, appid: numAppId, name: gameName });
});

// SPA fallback
app.get('*', (req, res) => {
  if (fs.existsSync(path.join(distPath, 'index.html'))) {
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    res.status(503).send('IdleTool backend is running, but the frontend build was not found.');
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`IdleTool server running at ${BASE_URL}`);
});

function shutdown() {
  for (const appId of Array.from(activeSessions.keys())) stopIdleSession(appId);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2000).unref();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
