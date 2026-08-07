@echo off
title IdleTool
echo ===================================================
echo                    IDLETOOL
echo ===================================================
echo.
echo [1/3] Checking SteamWorker C# Executable...
if not exist "%~dp0SteamWorker\publish\SteamWorker.exe" (
    echo Building SteamWorker C# binary...
    cd /d "%~dp0SteamWorker"
    dotnet publish -c Release -r win-x64 --self-contained false -o publish
)

echo [2/3] Checking Frontend Build...
if not exist "%~dp0frontend\dist\index.html" (
    echo Building React Frontend...
    cd /d "%~dp0frontend"
    call npm run build
)

echo [3/3] Launching IdleTool...
start "" "http://localhost:3824"
cd /d "%~dp0backend"
node server.js
pause
