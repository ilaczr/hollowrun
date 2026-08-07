# IdleTool

IdleTool is a local Windows utility that asks the running Steam desktop client to report selected AppIDs as active. It does not need a Steam password, Steam Guard code, API key, or third-party license account.

## What it does

- Detects the Steam installation from the current user's registry or standard install paths.
- Reads local Steam manifests, `loginusers.vdf`, and `localconfig.vdf` to show installed games and play history.
- Queries Steam's public Store API for game metadata and search results.
- Starts one isolated `IdleTool.Worker` process per selected AppID, up to 32 concurrent sessions.
- Stores only local metadata caches and custom AppIDs under `backend/`.

## Security and privacy

- The control API binds only to `127.0.0.1:3824` and validates host/origin headers.
- The application never asks for or transmits account credentials.
- Outbound application requests are limited to Steam Store API/CDN endpoints.
- Electron renderer isolation and a restrictive Content Security Policy are enabled.
- Worker processes run as the current user and communicate with the already-running Steam client through Steamworks.

## Requirements

- Windows with the Steam desktop client running and logged in.
- Node.js 22.12 or newer for Electron development and packaging.
- .NET 10 runtime for the included Steam worker.
- .NET 10 SDK only when rebuilding the Steam worker or launcher.

## Run from source

```powershell
npm ci
npm run setup
npm run build:frontend
npm start
```

Alternatively, `start-idletool.bat` installs missing backend/frontend dependencies, builds missing artifacts, and starts the browser-based dashboard.

## Development

Run the backend and Vite frontend together:

```powershell
npm run setup
npm run dev
```

The Vite development server is available only on `127.0.0.1` and proxies `/api` to the local backend.

## Build

```powershell
npm ci
npm run setup
npm run build:worker
npm run build
```

Electron packages are written to `dist-electron/`.

## Project structure

- `backend/`: local Express API, Steam library scanning, Store API access, and worker lifecycle management.
- `frontend/`: React/Vite dashboard.
- `IdleTool.Worker/`: minimal .NET Steamworks process used for each active AppID.
- `IdleTool.Launcher/`: optional .NET launcher for the browser-hosted dashboard.
- `electron-main.cjs`: Electron main process.
