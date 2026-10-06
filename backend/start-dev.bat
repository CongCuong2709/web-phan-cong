@echo off
REM ============================================================================
REM start-dev.bat — Khởi động backend server (development mode)
REM
REM Su dung:
REM   start-dev.bat                : Cleanup + dev server (mac dinh)
REM   start-dev.bat /seed          : Cleanup + install + seed + dev (lan dau)
REM   start-dev.bat /reset         : NUCLEAR reset - xoa het + reinstall + seed
REM   start-dev.bat /no-clean      : Giu nguyen DB cu, chi chay dev
REM   start-dev.bat /prod          : Production mode (khong watch)
REM
REM Yeu cau: Node.js >= 22.5.0 (cho node:sqlite built-in)
REM ============================================================================

setlocal EnableExtensions EnableDelayedExpansion

REM Chuyen ve thu muc chua script nay
cd /d %~dp0

REM ============================================================================
REM Parse arguments
REM ============================================================================
set MODE=dev
set CLEAN=1
set WATCH_FLAG=--watch
for %%A in (%*) do (
    if /i "%%A"=="/seed"      set MODE=seed
    if /i "%%A"=="-seed"      set MODE=seed
    if /i "%%A"=="--seed"     set MODE=seed
    if /i "%%A"=="/reset"     set MODE=reset
    if /i "%%A"=="-reset"     set MODE=reset
    if /i "%%A"=="/no-clean"  set CLEAN=0
    if /i "%%A"=="-no-clean"  set CLEAN=0
    if /i "%%A"=="/prod"      set WATCH_FLAG=
    if /i "%%A"=="-prod"      set WATCH_FLAG=
)

cls
echo.
echo ============================================================================
echo   Backend - 4-Tier Enterprise Execution System
echo   Mode: %MODE%
echo ============================================================================
echo.

REM ============================================================================
REM 0. Kiem tra Node.js version
REM ============================================================================
echo [1/5] Kiem tra Node.js...
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
REM Strip prefix 'v' tu NODE_FULL (vd: "v24" -> "24")
set NODE_MAJOR=%NODE_FULL:v=%
set NODE_OK=0
if !NODE_MAJOR! GTR 22 set NODE_OK=1
if !NODE_MAJOR! EQU 22 if !NODE_MINOR! GEQ 5 set NODE_OK=1
if "!NODE_OK!"=="0" (
    echo  [!] Canh bao: Hien tai v!NODE_MAJOR!.!NODE_MINOR!.!NODE_PATCH! - nen dung ^>= 22.5.0
    echo      Tiep tuc sau 15 giay... ^(Ctrl+C de huy^)
    timeout /t 15 /nobreak
)
echo      OK: Node v!NODE_MAJOR!.!NODE_MINOR!.!NODE_PATCH!
echo.

REM ============================================================================
REM 1. Cleanup (tru /no-clean)
REM ============================================================================
if "%CLEAN%"=="1" (
    echo [2/5] Don dep files cu...
    set CLEANED=0
    if exist package-lock.json (
        del /f /q package-lock.json >nul 2>&1
        echo      + package-lock.json
        set /a CLEANED+=1
    )
    if exist database.db (
        del /f /q database.db >nul 2>&1
        echo      + database.db
        set /a CLEANED+=1
    )
    if exist database.db-shm (
        del /f /q database.db-shm >nul 2>&1
        set /a CLEANED+=1
    )
    if exist database.db-wal (
        del /f /q database.db-wal >nul 2>&1
        set /a CLEANED+=1
    )
    if !CLEANED! EQU 0 (
        echo      (Khong co gi can don)
    )
) else (
    echo [2/5] Skip cleanup (che do /no-clean)
)
echo.

REM ============================================================================
REM 2. NUCLEAR reset
REM ============================================================================
if "%MODE%"=="reset" (
    echo [3/5] NUCLEAR reset - xoa node_modules va reinstall...
    if exist node_modules (
        echo      Xoa node_modules ^(vai phut^)...
        rmdir /s /q node_modules >nul 2>&1
        echo      + Da xoa node_modules
    )
    call npm install
    if errorlevel 1 (
        echo  [X] npm install that bai!
        pause
        exit /b 1
    )
    echo      OK: Da cai lai
) else (
    REM Cai dat neu chua co
    if not exist node_modules (
        echo [3/5] Cai dat dependencies ^(lan dau^)...
        call npm install
        if errorlevel 1 (
            echo  [X] npm install that bai!
            pause
            exit /b 1
        )
        echo      OK: Cai xong
    ) else (
        echo [3/5] node_modules OK ^(skip install^)
    )
)
echo.

REM ============================================================================
REM 3. Khoi tao database.db neu chua co
REM ============================================================================
if not exist database.db (
    echo [4/5] Tao database.db + apply schema...
    REM Trigger schema bootstrap qua node:sqlite side-effect import
    call node -e "import('./db.js').then(m => { console.log('     OK: Schema applied.'); m.db.close(); }).catch(e => { console.error('     FAIL:', e.message); process.exit(1); })"
    if errorlevel 1 (
        echo  [X] Khong the tao database.db
        pause
        exit /b 1
    )
) else (
    echo [4/5] database.db OK ^(skip init^)
)
echo.

REM ============================================================================
REM 4. Seed data neu co flag /seed hoac /reset
REM ============================================================================
if "%MODE%"=="seed" (
    echo [5/5] Seeding database...
    call npx tsx scripts/seed.ts
    if errorlevel 1 (
        echo  [X] Seed that bai!
        pause
        exit /b 1
    )
    echo.
)
if "%MODE%"=="reset" (
    echo [5/5] Seeding database ^(sau reset^)...
    call npx tsx scripts/seed.ts
    if errorlevel 1 (
        echo  [X] Seed that bai!
        pause
        exit /b 1
    )
    echo.
)

REM ============================================================================
REM 5. Start dev server
REM ============================================================================
echo ============================================================================
echo   San sang! Khoi dong dev server...
echo   URL:    http://localhost:3000
echo   Health: http://localhost:3000/api/health
echo   Login:  POST /api/auth/login ^(admin/admin123^)
echo.
echo   Ctrl+C de dung server.
echo ============================================================================
echo.

if "%WATCH_FLAG%"=="--watch" (
    call npm run dev
) else (
    call npm run start
)

endlocal