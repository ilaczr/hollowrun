# HollowRun

HollowRun is a portable Windows desktop application for managing local Steam idling sessions. It connects to the Steam client already running on the computer and does not request Steam credentials, Steam Guard codes, or a Web API key.

![HollowRun](https://i.ibb.co/bgygM73K/Screenshot-2026-08-09-232218.png)

## Features

- Reads the active account's installed games and local Steam play history.
- Searches and displays verified games owned by the active Steam account.
- Runs isolated Steamworks worker processes with a sequential task queue.
- Uses a native, always-on-top startup splash while the portable executable extracts.
- Stores runtime metadata and window state locally.

## Requirements

- Windows 10 or Windows 11.
- Steam running and signed in.
- Node.js 22.12 or newer to build from source.
- .NET 10 SDK to build the worker and splash projects.
- .NET 10 Desktop Runtime to run the packaged worker and splash helper.

## Build

Install dependencies and create the portable executable:

```powershell
npm.cmd ci
npm.cmd run setup
npm.cmd run build
```

The output is written to `dist-electron\HollowRun <version>.exe`. See [COMMANDS.MD](COMMANDS.MD) for the complete build notes and [VERSIONING.md](VERSIONING.md) for the release-version workflow.

## Project structure

- `backend/` — local API, Steam library discovery, metadata, and worker management.
- `frontend/` — React interface compiled into the Electron application.
- `HollowRun.Worker/` — isolated Steamworks worker used for an active AppID.
- `HollowRun.Splash/` — native startup splash for the portable build.
- `scripts/` — versioning, branding, and portable-build preparation.
- `electron-main.cjs` — Electron application lifecycle and local backend startup.

Generated dependencies, caches, publish folders, and packaged output are intentionally excluded from Git.

## Release Download

GitHub: [Releases](https://github.com/ju6697/hollowrun/releases)

Codeberg: [Releases](https://codeberg.org/ju6697/hollowrun/releases)