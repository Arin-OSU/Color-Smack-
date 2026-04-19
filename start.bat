@echo off
cd /d "%~dp0"

echo Starting CampusSense...

if not exist ".next" (
    echo Building for first run, this takes about 30 seconds...
    call pnpm build
    if errorlevel 1 (
        echo Build failed. Make sure pnpm is installed ^(run: npm install -g pnpm^).
        pause
        exit /b 1
    )
)

echo Launching server...
start "CampusSense Server" cmd /k "pnpm start"

echo Waiting for server to start...
timeout /t 5 /nobreak >nul

start "" http://localhost:3000

echo.
echo CampusSense is running at http://localhost:3000
echo Close the "CampusSense Server" window to stop the server.
