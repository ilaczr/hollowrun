const { app, BrowserWindow, screen, utilityProcess } = require('electron');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {
  MIN_HEIGHT,
  MIN_WIDTH,
  fitWindowStateToDisplay,
  readWindowState,
  writeWindowState
} = require('./window-state.cjs');

const SERVER_URL = 'http://127.0.0.1:3824';
const instanceToken = crypto.randomBytes(32).toString('hex');
let mainWindow;
let serverProcess;
let windowStateSaveTimer;

app.setName('HollowRun');

const checkServer = () => {
  return new Promise((resolve) => {
    const req = http.get(`${SERVER_URL}/api/status`, (res) => {
      res.resume();
      if (res.statusCode === 200 && res.headers['x-hollowrun-instance'] === instanceToken) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
};

const waitForServer = async (retries = 30) => {
  for (let i = 0; i < retries; i++) {
    const isReady = await checkServer();
    if (isReady) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
};

function createWindow() {
  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  const savedState = readWindowState(stateFile);
  const restoredState = savedState ? fitWindowStateToDisplay(savedState, screen) : null;
  const shouldMaximize = restoredState ? restoredState.isMaximized : true;

  mainWindow = new BrowserWindow({
    ...(restoredState
      ? { x: restoredState.x, y: restoredState.y, width: restoredState.width, height: restoredState.height }
      : { width: 1280, height: 800 }),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: '#0e1219',
    title: 'HollowRun',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0e1219',
      symbolColor: '#f1f5f9',
      height: 32
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false
    },
    icon: path.join(__dirname, 'frontend/public/hollowrun.svg')
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== SERVER_URL && url !== `${SERVER_URL}/`) event.preventDefault();
  });

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
  mainWindow.loadURL(SERVER_URL);

  mainWindow.on('closed', function () {
    clearTimeout(windowStateSaveTimer);
    windowStateSaveTimer = null;
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const serverPath = path.join(__dirname, 'backend', 'server.js');

  serverProcess = utilityProcess.fork(serverPath, [], {
    env: { ...process.env, ELECTRON_APP: 'true', HOLLOWRUN_INSTANCE_TOKEN: instanceToken },
    stdio: 'pipe'
  });
  serverProcess.stdout?.on('data', (data) => console.log(data.toString().trimEnd()));
  serverProcess.stderr?.on('data', (data) => console.error(data.toString().trimEnd()));
  serverProcess.on('exit', (code) => {
    if (code !== 0) console.error(`Backend process exited with code ${code}.`);
  });

  const isReady = await waitForServer();

  if (isReady) {
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
