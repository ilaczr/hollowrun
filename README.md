# IdleTool

A zero-credential, local Steam idling tool for Windows that connects directly to your active Steam desktop client instance using Steamworks IPC.

## 🌟 Key Features
- **0 Credentials Required**: Works directly with your running Steam desktop client session. No account password, Steam Guard 2FA, or API keys needed.
- **Deep Library Auto-Discovery**: Auto-detects installed Steam games from manifest files and parses your full historical library and playtime data directly from your local `localconfig.vdf`.
- **Active Profile Scanner**: Reads your active Steam profile persona name and SteamID64.
- **Steam Store Search & Enrichment**: Live querying of the entire Steam catalog to find any game. Enriches local games with metadata from the Steam API (Metacritic scores, genres, trading card drops).
- **Multi-Game Idling**: Idle single games or batch-idle multiple games simultaneously directly through Steam IPC.
- **Auto-Stop Timers**: Configurable session limiters (e.g. 30m, 1h, 2h, 3.5h, 5h).
- **Custom AppIDs**: Add any Steam AppID with automatic header banner artwork loading from Steam CDN.
- **Glassmorphism UI**: High-aesthetic React frontend running locally at `http://localhost:3824`.

---

## 🚀 Tutorial: How to Use IdleTool

This app uses your running Steam instance to trick Steam into thinking you are playing a game. This is useful for getting trading card drops or increasing your playtime hours without actually installing or running the game.

### Step 1: Getting Started
1. Open your **Steam Desktop Client** and make sure you are logged into your Steam account.
2. Double-click **`IdleTool.exe`** (or use the Setup Installer) in the `dist-electron` folder if you built it, or simply double-click the `.exe` that you downloaded.
3. The app will open in a native, gorgeous Desktop Window!

### Step 2: Exploring the Dashboard
When you open the dashboard, the tool will automatically scan your Steam installation and extract:
- Your **Installed** games.
- Your entire **History** of games you have ever played on this account, including your historical playtime and when you last played them.
- A **Library Stats** dashboard showing your total hours played across all Steam games!

The UI will automatically enrich these games with data directly from Steam, showing Metacritic scores, Genres, and if the game has **Steam Trading Cards**.

### Step 3: Start Idling!
You don't need to have the game installed to idle it.
- **To idle a game from your library/presets**: Browse your Installed, History, or Presets tab and click the **Start Idling** button on any game. 
- **To batch idle**: Check the checkboxes on the game cards, and click the **Start Selected** button at the top. Note: Steam limits you to idling around 30-32 games at a time.

### Step 4: Finding ANY Game on Steam
Want to idle a game you don't even own yet, or can't find in your history?
1. Click the **🔍 Steam Store** tab.
2. Type in the name of *any* game on Steam (e.g., "Elden Ring" or "Counter-Strike").
3. The results will instantly pop up. Click "Start Idling" directly from the search results!

### Step 5: Managing Active Sessions & Auto-Stop
- Under the **Active** tab, you can see all currently idling games with a live elapsed timer.
- Look at your Steam Friends List—it will say you are "In-Game" for all these games!
- In the top bar, you can set an **Auto-Stop Timer** (e.g., 2 hours). If set, any game that idles for 2 hours will automatically be stopped.
- To stop everything immediately, click the red **Stop All** button.

---

## 💻 Tech Stack
- **Backend**: Node.js, Express
- **Frontend**: React, Vite, Vanilla CSS (Custom Glassmorphism Design)
- **Worker Process**: C# (.NET 10), Facepunch.Steamworks
