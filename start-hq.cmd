@echo off
rem Claude HQ launcher: starts the local server if it isn't running, then opens HQ in its own app window.
cd /d "%~dp0"
powershell -NoProfile -Command "try { Invoke-WebRequest http://127.0.0.1:4321/api/state -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "Claude HQ server (close to stop)" /min node server.mjs
  rem the first scan of the session logs takes a few seconds
  powershell -NoProfile -Command "for ($i = 0; $i -lt 60; $i++) { try { Invoke-WebRequest http://127.0.0.1:4321/api/state -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep 1 } }; exit 1"
)
start "" msedge --app=http://localhost:4321 --window-size=1600,960
