@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

set "REPO_URL=https://github.com/CongCuong2709/web-phan-cong.git"

cls
echo.
echo  ================================================
echo   Cap nhat ma nguon tu GitHub
echo  ================================================
echo.

:: Kiem tra Git
where git >nul 2>&1
if errorlevel 1 (
    echo  [X] Chua co Git! Tai tai: https://git-scm.com
    echo.
    pause
    exit /b 1
)

:: Neu da co .git => pull, chua co => clone
if exist ".git" (
    echo  [1/2] Dang kiem tra thay doi cuc bo...
    :: Stage tat ca file (bao gom ca untracked file nhu update-code.bat) roi stash
    git add -A >nul 2>&1
    git stash >nul 2>&1

    echo  [2/2] Dang lay code moi nhat tu GitHub...
    git fetch origin
    for /f "tokens=*" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%b"
    if "!BRANCH!"=="" set "BRANCH=main"
    git pull origin !BRANCH!
    if errorlevel 1 (
        git pull origin main 2>nul || git pull origin master
    )

    git stash pop >nul 2>&1

) else (
    echo  [1/2] Lan dau — Dang clone tu GitHub...
    echo        %REPO_URL%
    echo.
    git clone "%REPO_URL%" .
    if errorlevel 1 (
        echo.
        echo  [X] Clone that bai! Kiem tra ket noi mang.
        pause
        exit /b 1
    )
    echo  [2/2] Xong.
)

if errorlevel 1 (
    echo.
    echo  [X] Co loi khi lay code! Kiem tra ket noi mang.
    pause
    exit /b 1
)

echo.
echo  ================================================
for /f "tokens=*" %%h in ('git log -1 --format^="  Commit: %%h  %%s" 2^>nul') do echo %%h
echo  [OK] Ma nguon da duoc cap nhat thanh cong!
echo  ================================================
echo.
pause
endlocal
