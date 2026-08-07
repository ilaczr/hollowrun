const { app, BrowserWindow, utilityProcess } = require('electron');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const SERVER_URL = 'http://127.0.0.1:3824';
const instanceToken = crypto.randomBytes(32).toString('hex');
let mainWindow;
let serverProcess;

const checkServer = () => {
  return new Promise((resolve) => {
    const req = http.get(`${SERVER_URL}/api/status`, (res) => {
      res.resume();
      if (res.statusCode === 200 && res.headers['x-idletool-instance'] === instanceToken) {
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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    title: 'IdleTool',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0e1219',
      symbolColor: '#f1f5f9'
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false
    },
    icon: path.join(__dirname, 'frontend/public/idletool.svg')
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== SERVER_URL && url !== `${SERVER_URL}/`) event.preventDefault();
  });
  mainWindow.loadURL(SERVER_URL);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Spawn the Node.js Express server
  const serverPath = path.join(__dirname, 'backend', 'server.js');
  
  // Use utilityProcess to run the backend safely in a packaged app without a console window
  serverProcess = utilityProcess.fork(serverPath, [], {
    env: { ...process.env, ELECTRON_APP: 'true', IDLETOOL_INSTANCE_TOKEN: instanceToken },
    stdio: 'pipe'
  });
  serverProcess.stdout?.on('data', (data) => console.log(data.toString().trimEnd()));
  serverProcess.stderr?.on('data', (data) => console.error(data.toString().trimEnd()));
  serverProcess.on('exit', (code) => {
    if (code !== 0) console.error(`Backend process exited with code ${code}.`);
  });

  // Wait for the backend API to be ready
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

// Ensure backend is killed when Electron exits
app.on('before-quit', () => {
  if (serverProcess) {
    console.log('Terminating backend server...');
    serverProcess.kill();
    serverProcess = null;
  }
});
