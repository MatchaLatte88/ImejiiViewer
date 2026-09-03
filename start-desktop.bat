@echo off
title Imejii (Desktop)
cd /d "%~dp0"

echo.
echo   Imejii wird als Desktop-App gestartet ...
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

echo   Dieses Fenster offen lassen - es haelt den Entwicklungsserver am Leben.
echo.

call npm run desktop

echo.
echo   Die Anwendung wurde beendet.
pause
