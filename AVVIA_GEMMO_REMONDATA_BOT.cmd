@echo off
setlocal EnableExtensions
title GEMMO REMONDATA BOT - OANDA PAPER

cd /d "%~dp0"
if not exist "package.json" goto missing

if not exist ".env" (
  echo Credenziali locali non salvate: apro il bot Railway gia configurato in PAPER.
  start "" "https://scalp-bot-production-761a.up.railway.app/"
  exit /b 0
)

set "TRADING_MODE=PAPER"
set "OANDA_ENVIRONMENT=PRACTICE"
set "OANDA_ORDER_EXECUTION_ENABLED=false"
set "LIVE_TRADING_ENABLED=false"
set "LIVE_EXECUTION_VARIANT=MAIN"

echo [1/3] Build dashboard professionale...
call npm.cmd run build
if errorlevel 1 goto error

echo [2/3] Avvio una sola istanza con riavvio automatico...
call npx.cmd pm2 startOrRestart ecosystem.config.js --only scalp-bot --update-env
if errorlevel 1 goto error

echo [3/3] Attendo il server e apro il Setup...
powershell.exe -NoProfile -Command "$limit=(Get-Date).AddSeconds(30); do { try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:3000/health; if ($r.StatusCode -eq 200) { Start-Process 'http://127.0.0.1:3000/setup'; exit 0 } } catch {}; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $limit); exit 1"
if errorlevel 1 goto error

echo.
echo GEMMO REMONDATA BOT avviato in PAPER. Nessun ordine OANDA viene inviato.
echo Usa: npx.cmd pm2 logs scalp-bot
exit /b 0

:missing
echo Repository non trovato: %CD%
exit /b 1

:error
echo.
echo Avvio non riuscito. Controlla il messaggio sopra.
pause
exit /b 1
