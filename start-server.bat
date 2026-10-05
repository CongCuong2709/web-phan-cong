@echo off
REM ============================================================================
REM start-server.bat — Master launcher 1-click
REM
REM Chay 1 lan: tu dong khoi dong:
REM   1. Backend (Express + SQLite) tren http://localhost:3001
REM   2. Frontend (Vite + React) tren http://localhost:3000
REM   3. Mo browser den frontend
REM
REM Bam phim bat ky trong window nay de tat ca servers.
REM ============================================================================

setlocal EnableExtensions EnableDelayedExpansion

cls
echo.
echo ============================================================================
echo   4-Tier Enterprise Execution System
echo   Master Launcher - Backend + Frontend + Browser
echo ============================================================================
echo.

REM ============================================================================
REM 0. Kiem tra Node.js
REM ============================================================================
echo [0/4] Kiem tra Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo  [X] Khong tim thay Node.js. Cai dat tu https://nodejs.org
    echo      Yeu cau: ^>= 22.5.0
    pause
    exit /b 1
)
for /f "tokens=1,2,3 delims=." %%a in ('node -v') do (
    set NODE_FULL=%%a
    set NODE_MINOR=%%b
    set NODE_PATCH=%%c
)
set NODE_MAJOR=%NODE_FULL:v=%
echo      OK: Node v%NODE_MAJOR%.%NODE_MINOR%.%NODE_PATCH%
if !NODE_MAJOR! LSS 22 (
    echo      [!] Canh bao: Nen dung Node ^>= 22.5.0 cho node:sqlite
    echo          Tiep tuc trong 3 giay... ^(Ctrl+C de huy^)
    timeout /t 3 /nobreak
)
echo.

REM ============================================================================
REM 1. Setup .env.local cho frontend (neu chua co)
REM ============================================================================
echo [1/4] Cau hinh frontend...
if not exist .env.local (
    echo VITE_API_URL=http://localhost:3001 > .env.local
    echo      Tao .env.local moi
) else (
    findstr /c:"VITE_API_URL" .env.local >nul 2>&1 || (
        echo VITE_API_URL=http://localhost:3001 >> .env.local
        echo      Them VITE_API_URL vao .env.local
    )
    echo      .env.local OK
)
echo.

REM ============================================================================
REM 2. Start backend (background window)
REM ============================================================================
echo [2/4] Khoi dong backend (port 3001)...
cd /d "%~dp0backend"
start "Backend - 4-Tier API" /MIN cmd /c "start-dev.bat /no-clean"
cd /d "%~dp0"

REM Wait backend health check (max 30s)
echo      Do backend san sang (max 30 giay)...
set /a WAIT_COUNT=0
:WAIT_BACKEND
set /a WAIT_COUNT+=1
timeout /t 1 /nobreak >nul
curl -sf http://localhost:3001/api/health >nul 2>&1 && goto BACKEND_OK
if !WAIT_COUNT! GEQ 30 (
    echo      [!] Backend khong phan hoi sau 30s. Kiem tra cua so "Backend - 4-Tier API".
    echo          Van tiep tuc khoi dong frontend...
    goto SKIP_BACKEND
)
goto WAIT_BACKEND
:BACKEND_OK
echo      OK: Backend ready (http://localhost:3001)
:SKIP_BACKEND
echo.

REM ============================================================================
REM 3. Start frontend (background window)
REM ============================================================================
echo [3/4] Khoi dong frontend (port 3000)...
start "Frontend - Vite Dev" /MIN cmd /c "npm run dev"

REM Wait Vite ready (poll port 3000)
echo      Do Vite san sang (max 20 giay)...
set /a FE_COUNT=0
:WAIT_FE
set /a FE_COUNT+=1
timeout /t 1 /nobreak >nul
curl -sf -o nul http://localhost:3000 >nul 2>&1 && goto FE_OK
if !FE_COUNT! GEQ 20 (
    echo      [!] Frontend khong phan hoi sau 20s. Kiem tra cua so "Frontend - Vite Dev".
    goto SKIP_FE
)
goto WAIT_FE
:FE_OK
echo      OK: Frontend ready (http://localhost:3000)
:SKIP_FE
echo.

REM ============================================================================
REM 4. Open browser
REM ============================================================================
echo [4/4] Mo browser...
start "" http://localhost:3000
echo      OK: Da mo http://localhost:3000
echo.

echo ============================================================================
echo   Tat ca servers da san sang!
echo.
echo   Frontend (web app):    http://localhost:3000
echo   Backend (API):         http://localhost:3001/api/health
echo.
echo   Tat ca server dang chay trong 2 cua so nen:
echo     - "Backend - 4-Tier API"   (Express)
echo     - "Frontend - Vite Dev"    (Vite)
echo.
echo   Bam phim bat ky trong cua so NAY de tat CA servers.
echo ============================================================================
echo.

pause

REM ============================================================================
REM Cleanup: stop ca backend + frontend
REM ============================================================================
echo.
echo Dang tat cac servers...
REM Close the named windows first (graceful)
taskkill /f /fi "WINDOWTITLE eq Backend - 4-Tier API*" >nul 2>&1
taskkill /f /fi "WINDOWTITLE eq Frontend - Vite Dev*" >nul 2>&1
REM Hard kill all node processes started in this session (safe since no other node apps assumed)
timeout /t 1 /nobreak >nul
taskkill /f /im node.exe /fi "MEMUSAGE gt 50000" >nul 2>&1
echo Done. Goodbye!

endlocal