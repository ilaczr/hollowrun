const { app, BrowserWindow, utilityProcess } = require('electron');
const path = require('path');
const http = require('http');

let mainWindow;
let serverProcess;

const checkServer = () => {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3824/api/status', (res) => {
      if (res.statusCode === 200) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    req.on('error', () => resolve(false));
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
      contextIsolation: true
    },
    icon: path.join(__dirname, 'frontend/public/favicon.svg')
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL('http://localhost:3824');

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Spawn the Node.js Express server
  const serverPath = path.join(__dirname, 'backend', 'server.js');
  
  // Use utilityProcess to run the backend safely in a packaged app without a console window
  serverProcess = utilityProcess.fork(serverPath, [], {
    env: { ...process.env, ELECTRON_APP: 'true' },
    stdio: 'pipe'
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
app.on('quit', () => {
  if (serverProcess) {
    console.log('Terminating backend server...');
    serverProcess.kill('SIGINT');
  }
});
