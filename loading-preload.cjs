const { contextBridge, ipcRenderer } = require('electron');

const crashReportingActive = process.argv.includes('--hollowrun-crash-reporting=1');
const testReportsAvailable = process.argv.includes('--hollowrun-test-reports=1');

const hollowrunApi = {
  crashReportingActive,
  testReportsAvailable,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setAutomaticCrashReports: enabled => ipcRenderer.invoke('settings:set-crash-reports', enabled),
  restart: () => ipcRenderer.invoke('app:restart')
};

if (testReportsAvailable) {
  hollowrunApi.sendTestCrashReport = () => ipcRenderer.invoke('crash-reporting:test');
}

contextBridge.exposeInMainWorld('hollowrun', Object.freeze(hollowrunApi));

let startupState = {
  progress: 8,
  action: 'Preparing application window...'
};

function renderStartupState() {
  const progress = document.getElementById('startup-progress');
  const progressFill = document.getElementById('startup-progress-fill');
  const action = document.getElementById('startup-action');
  if (!progress || !progressFill || !action) return;

  progress.setAttribute('aria-valuenow', String(startupState.progress));
  progressFill.style.width = `${startupState.progress}%`;
  action.textContent = startupState.action;
}

ipcRenderer.on('startup-progress', (_event, nextState) => {
  const progress = Number(nextState?.progress);
  const action = typeof nextState?.action === 'string' ? nextState.action.trim() : '';
  if (!Number.isFinite(progress) || !action) return;

  startupState = {
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    action: action.slice(0, 120)
  };
  renderStartupState();
});

window.addEventListener('DOMContentLoaded', renderStartupState, { once: true });
