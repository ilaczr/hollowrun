const { app, BrowserWindow, dialog, screen, session, utilityProcess } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const http = require('http');
const crypto = require('crypto');
const { isSteamClientReady } = require('./startup-gate.cjs');
const {
  MIN_HEIGHT,
  MIN_WIDTH,
  fitWindowStateToDisplay,
  readWindowState,
  writeWindowState
} = require('./window-state.cjs');

const SERVER_URL = 'http://127.0.0.1:3824';
const LOADING_PAGE_PATH = path.join(__dirname, 'loading.html');
const LOADING_PAGE_URL = pathToFileURL(LOADING_PAGE_PATH).href;
const SERVER_STARTUP_TIMEOUT_MS = 15000;
const SERVER_RETRY_INTERVAL_MS = 150;
const DEFAULT_WINDOW_WIDTH = 1600;
const DEFAULT_WINDOW_HEIGHT = 900;
const DEFAULT_WINDOW_WORK_AREA_INSET = 48;
const LEGACY_STEAM_COMMUNITY_PARTITION = 'persist:hollowrun-steam-community';
const instanceToken = crypto.randomBytes(32).toString('hex');
let mainWindow;
let serverProcess;
let windowStateSaveTimer;
let backendReady = false;
let startupState = {
  progress: 8,
  action: 'Preparing application window...'
};

app.setName('HollowRun');

async function clearLegacySteamCommunitySession() {
  const legacySession = session.fromPartition(LEGACY_STEAM_COMMUNITY_PARTITION);
  await Promise.all([
    legacySession.clearStorageData(),
    legacySession.clearCache()
  ]);
}

function getDefaultWindowBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.max(
    MIN_WIDTH,
    Math.min(DEFAULT_WINDOW_WIDTH, workArea.width - DEFAULT_WINDOW_WORK_AREA_INSET)
  );
  const height = Math.max(
    MIN_HEIGHT,
    Math.min(DEFAULT_WINDOW_HEIGHT, workArea.height - DEFAULT_WINDOW_WORK_AREA_INSET)
  );

  return {
    x: workArea.x + Math.max(0, Math.round((workArea.width - width) / 2)),
    y: workArea.y + Math.max(0, Math.round((workArea.height - height) / 2)),
    width,
    height
  };
}

function publishStartupProgress() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const currentUrl = mainWindow.webContents.getURL();
  if (currentUrl !== LOADING_PAGE_URL && !currentUrl.startsWith(`${LOADING_PAGE_URL}?`)) return;
  mainWindow.webContents.send('startup-progress', startupState);
}

function updateStartupProgress(progress, action) {
  startupState = {
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    action
  };
  publishStartupProgress();
}

const checkServer = () => {
  return new Promise((resolve) => {
    const req = http.get(`${SERVER_URL}/api/health`, {
      headers: { 'X-HollowRun-Instance': instanceToken }
    }, (res) => {
      res.resume();
      resolve(res.statusCode === 200 && res.headers['x-hollowrun-instance'] === instanceToken);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(750, () => {
      req.destroy();
      resolve(false);
    });
  });
};

const waitForServer = async () => {
  const startedAt = Date.now();
  const deadline = Date.now() + SERVER_STARTUP_TIMEOUT_MS;
  updateStartupProgress(34, 'Waiting for local services...');

  do {
    if (await checkServer()) {
      updateStartupProgress(78, 'Local services are ready.');
      return true;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const elapsedRatio = (Date.now() - startedAt) / SERVER_STARTUP_TIMEOUT_MS;
    updateStartupProgress(34 + Math.min(40, Math.floor(elapsedRatio * 40)), 'Waiting for local services...');
    await new Promise(resolve => setTimeout(resolve, Math.min(SERVER_RETRY_INTERVAL_MS, remaining)));
  } while (Date.now() < deadline);

  return false;
};

const getBackendStatus = () => {
  return new Promise((resolve) => {
    const req = http.get(`${SERVER_URL}/api/status`, {
      headers: { 'X-HollowRun-Instance': instanceToken }
    }, (res) => {
      if (res.statusCode !== 200 || res.headers['x-hollowrun-instance'] !== instanceToken) {
        res.resume();
        resolve(null);
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (body.length > 65536) req.destroy();
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(null);
    });
  });
};

async function showSteamClientRequired(status) {
  const steamWasFound = status?.steamInstalled === true;
  await dialog.showMessageBox({
    type: 'warning',
    title: 'Steam Client Required',
    message: steamWasFound
      ? 'Steam Client must be running and signed in before HollowRun can start.'
      : 'Steam could not be found on this computer.',
    detail: steamWasFound
      ? 'Open Steam, sign in to your account, then start HollowRun again.'
      : 'Install Steam or repair its installation, then start HollowRun again.',
    buttons: ['Close HollowRun'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
}

function isAllowedNavigation(url) {
  return url === SERVER_URL
    || url === `${SERVER_URL}/`
    || url === LOADING_PAGE_URL
    || url.startsWith(`${LOADING_PAGE_URL}?`);
}

function loadWindowContent() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const load = backendReady
    ? mainWindow.loadURL(SERVER_URL)
    : mainWindow.loadFile(LOADING_PAGE_PATH);

  load.catch((error) => {
    if (error?.code !== 'ERR_ABORTED' && error?.errno !== -3) {
      console.error(`Could not load the HollowRun window: ${error.message}`);
    }
  });
}

function createWindow() {
  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  const savedState = readWindowState(stateFile);
  const restoredState = savedState ? fitWindowStateToDisplay(savedState, screen) : null;
  const shouldMaximize = restoredState?.isMaximized === true;
  const initialBounds = restoredState
    ? {
        x: restoredState.x,
        y: restoredState.y,
        width: restoredState.width,
        height: restoredState.height
      }
    : getDefaultWindowBounds();

  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: '#010203',
    title: 'HollowRun',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#030405',
      symbolColor: '#f3f5f7',
      height: 28
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      preload: path.join(__dirname, 'loading-preload.cjs')
    },
    icon: path.join(__dirname, 'frontend/public/hollowrun.png')
  });

  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: [`${SERVER_URL}/*`] },
    (details, callback) => {
      callback({
        requestHeaders: {
          ...details.requestHeaders,
          'X-HollowRun-Instance': instanceToken
        }
      });
    }
  );

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
  mainWindow.webContents.on('did-finish-load', publishStartupProgress);

  const saveWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    writeWindowState(stateFile, {
      ...mainWindow.getNormalBounds(),
      isMaximized: mainWindow.isMaximized()
    });
  };

  const scheduleWindowStateSave = () => {
    clearTimeout(windowStateSaveTimer);
    windowStateSaveTimer = setTimeout(saveWindowState, 250);
  };

  mainWindow.once('ready-to-show', () => {
    if (shouldMaximize) mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on('move', scheduleWindowStateSave);
  mainWindow.on('resize', scheduleWindowStateSave);
  mainWindow.on('maximize', scheduleWindowStateSave);
  mainWindow.on('unmaximize', scheduleWindowStateSave);
  mainWindow.on('close', saveWindowState);
  loadWindowContent();

  mainWindow.on('closed', function () {
    clearTimeout(windowStateSaveTimer);
    windowStateSaveTimer = null;
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await clearLegacySteamCommunitySession().catch(() => {});
  updateStartupProgress(20, 'Starting local services...');
  const serverPath = path.join(__dirname, 'backend', 'server.js');
  serverProcess = utilityProcess.fork(serverPath, [], {
    env: {
      ...process.env,
      ELECTRON_APP: 'true',
      HOLLOWRUN_INSTANCE_TOKEN: instanceToken,
      HOLLOWRUN_USER_DATA: app.getPath('userData')
    },
    stdio: 'pipe'
  });
  serverProcess.stdout?.on('data', (data) => console.log(data.toString().trimEnd()));
  serverProcess.stderr?.on('data', (data) => console.error(data.toString().trimEnd()));
  serverProcess.on('exit', (code) => {
    if (code !== 0) console.error(`Backend process exited with code ${code}.`);
  });

  if (await waitForServer()) {
    updateStartupProgress(82, 'Checking the Steam Client connection...');
    const status = await getBackendStatus();
    if (!isSteamClientReady(status)) {
      await showSteamClientRequired(status);
      app.quit();
      return;
    }

    updateStartupProgress(88, 'Loading your Steam library...');
    backendReady = true;
    createWindow();
  } else {
    console.error('Backend server failed to start on port 3824 in time.');
    app.quit();
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    console.log('Terminating backend server...');
    serverProcess.kill();
    serverProcess = null;
  }
});
