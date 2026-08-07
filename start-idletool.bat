@echo off
setlocal
title IdleTool

echo ===================================================
echo                    IDLETOOL
echo ===================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [Error] Node.js 20.19 or newer is required for the browser-hosted dashboard.
    exit /b 1
)

echo [1/4] Checking backend dependencies...
if not exist "%~dp0backend\node_modules\express\package.json" (
    call npm --prefix "%~dp0backend" ci
    if errorlevel 1 exit /b 1
)

echo [2/4] Checking Steam worker...
set "IDLETOOL_WORKER=%~dp0IdleTool.Worker\publish\IdleTool.Worker.exe"
if not exist "%IDLETOOL_WORKER%" if exist "%~dp0IdleTool.Worker\publish\SteamWorker.exe" set "IDLETOOL_WORKER=%~dp0IdleTool.Worker\publish\SteamWorker.exe"
if not exist "%IDLETOOL_WORKER%" (
    where dotnet >nul 2>&1
    if errorlevel 1 (
        echo [Error] The .NET 10 SDK is required to build IdleTool.Worker.
        exit /b 1
    )
    dotnet publish "%~dp0IdleTool.Worker\IdleTool.Worker.csproj" -c Release -r win-x64 --self-contained false -o "%~dp0IdleTool.Worker\publish"
    if errorlevel 1 exit /b 1
)

echo [3/4] Checking frontend build...
if not exist "%~dp0frontend\dist\index.html" (
    if not exist "%~dp0frontend\node_modules\vite\package.json" (
        call npm --prefix "%~dp0frontend" ci
        if errorlevel 1 exit /b 1
    )
    call npm --prefix "%~dp0frontend" run build
    if errorlevel 1 exit /b 1
)

echo [4/4] Launching IdleTool...
start "" "http://127.0.0.1:3824"
node "%~dp0backend\server.js"
