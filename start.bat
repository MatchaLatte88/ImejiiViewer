@echo off
title Imejii
cd /d "%~dp0"

echo.
echo   Imejii wird gestartet ...
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo   FEHLER: Node.js wurde nicht gefunden.
    echo   Bitte von https://nodejs.org installieren und dieses Fenster erneut starten.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo   Erster Start: Abhaengigkeiten werden installiert. Das dauert einen Moment ...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo   FEHLER: "npm install" ist fehlgeschlagen.
        echo.
        pause
        exit /b 1
    )
    echo.
)

echo   Server laeuft gleich auf http://localhost:5173
echo   Zum Beenden dieses Fenster schliessen oder Strg+C druecken.
echo.

call npm run dev -- --open

echo.
echo   Der Server wurde beendet.
pause
