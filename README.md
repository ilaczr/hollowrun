# HollowRun

HollowRun is a Windows desktop application for managing local Steam idling sessions, available as an installer or portable executable. It connects to the Steam client already running on the computer and does not request Steam credentials, Steam Guard codes, or an in-app sign-in.

![HollowRun](https://i.ibb.co/9HNz46rP/image.png)

## Features

- Reads the active account's installed games and local Steam play history.
- Searches and displays verified games owned by the active Steam account.
- Streams games with Steam trading-card drops remaining into the interface as each badge page is scanned.
- Runs the card-drop queue sequentially or starts up to Steam's 32-AppID limit together; later overflow stays queued.
- Custom "In-Game" status
- Displays the active account's current public avatar, full or animated background, animated mini-profile background, and animated avatar frame when available.
- Provides an opt-in, disabled-by-default crash reporter with privacy-filtered diagnostics.

## Requirements

- Windows 10 or Windows 11.
- Steam desktop client running with an account signed in before HollowRun starts.
- Node.js 22.12 or newer to build from source.
- .NET 10 SDK to build the worker and splash projects.
- .NET 10 Desktop Runtime to run the packaged worker and splash helper.

## Experimental custom In-Game label

Open the expandable Steam profile menu in HollowRun and choose **Enable hidden ghost**. This opt-in creates Steam's `.cef-enable-remote-debugging` marker, so Steam must be restarted once. Local Steam UI debugging remains enabled while that marker is installed; disable the feature from the same menu to remove HollowRun's marker and managed shortcut.

When applied, HollowRun creates or updates a non-Steam shortcut, moves it into Steam's Hidden collection, and runs a heartbeat-only helper under the chosen label. It is intended for Friends & Chat. Steam may still show the real Steam game on the public Community profile, and the shortcut remains visible under Hidden Games or in some running-game surfaces.

## Build

Install dependencies and create the installer and portable executable:

```powershell
npm.cmd ci
npm.cmd run setup
npm.cmd run build
```

The outputs are written to `dist-electron\HollowRun Setup <version>.exe` and
`dist-electron\HollowRun <version>.exe`. See [COMMANDS.MD](COMMANDS.MD) for the
complete build notes.

Crash reporting requires a Sentry project DSN, and readable production React stacks
require CI-only source-map credentials.

## Project structure

- `backend/` — local API, Steam library discovery, metadata, and worker management.
- `frontend/` — React interface compiled into the Electron application.
- `HollowRun.Worker/` — isolated Steamworks worker used for an active AppID.
- `HollowRun.Splash/` — native startup splash for the portable build.
- `scripts/` — versioning, branding, and portable-build preparation.
- `electron-main.cjs` — Electron application lifecycle and local backend startup.

Generated dependencies, caches, publish folders, and packaged output are intentionally excluded from Git.

## Release Download

GitHub: [Releases](https://github.com/iseethattown/hollowrun/releases)

Codeberg: [Releases](https://codeberg.org/iseethattown/hollowrun/releases)
