# HollowRun

HollowRun is a portable Windows desktop application for managing local Steam idling sessions. It connects to the Steam client already running on the computer and does not request Steam credentials, Steam Guard codes, or an in-app sign-in.

![HollowRun](https://i.ibb.co/bgygM73K/Screenshot-2026-08-09-232218.png)

## Features

- Reads the active account's installed games and local Steam play history.
- Searches and displays verified games owned by the active Steam account.
- Streams games with Steam trading-card drops remaining into the interface as each badge page is scanned.
- Runs the card-drop queue sequentially or starts up to Steam's 32-AppID limit together; later overflow stays queued.
- Displays the active account's current public avatar, full or animated background, animated mini-profile background, and animated avatar frame when available.
- Uses a native, always-on-top startup splash while the portable executable extracts.
- Stores runtime metadata and window state locally.

The **Games With Cards** section asks the running Steam client for its existing
Community session, uses it in memory to read the active account's badge pages,
and immediately discards it. HollowRun never opens a second sign-in flow and
does not save or log the Community session, password, or Steam Guard code.
Background library and card checks connect directly to the existing Steam user
without launching Spacewar or declaring any other game as running.
The queue refreshes its current game's drop count every minute and again after
manual **Stop** or **Stop All** actions. Manual stops pause the queue and never
start another game.
Concurrent queue runs refresh the complete card list periodically and stop each
game independently when its remaining drops reach zero.

### Steam profile decorations

The running Steam client's equipped-profile cache provides an immediate local
fallback for the active account's full background, mini background, animation
movies, and avatar frame. Because that cache can lag after a profile change,
HollowRun refreshes the same three decorations every 30 seconds through Steam's
official `IPlayerService/GetProfileItemsEquipped/v1` endpoint. That profile-item
method is publicly accessible, so HollowRun sends only the active account's
public SteamID64 directly to Steam. No Steam Web API key, HollowRun-hosted
service, Steam credentials, session cookies, or Steam Guard data are involved.
The full-size profile avatar is refreshed from the account's public Steam
Community profile on the same interval instead of reading Steam's local avatar
cache.

## Requirements

- Windows 10 or Windows 11.
- Steam desktop client running with an account signed in before HollowRun starts.
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

The output is written to `dist-electron\HollowRun <version>.exe`. See [COMMANDS.MD](COMMANDS.MD) for the complete build notes

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
