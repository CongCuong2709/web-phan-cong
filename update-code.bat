@echo off
chcp 65001 >nul
REM ============================================================================
REM update-code.bat — Tự động cập nhật / lấy code từ GitHub
REM Repository: https://github.com/CongCuong2709/web-phan-cong.git
REM ============================================================================

setlocal EnableExtensions EnableDelayedExpansion

cls
echo.
echo ============================================================================
echo   4-Tier Enterprise Execution System
echo   Tool cập nhật mã nguồn từ GitHub
echo ============================================================================
echo.

REM 1. Kiểm tra Git
where git >nul 2>&1
if errorlevel 1 (
    echo [X] LỖI: Không tìm thấy Git trên máy tính!
    echo     Vui lòng tải và cài đặt Git từ: https://git-scm.com
    echo.
    pause
    exit /b 1
)

echo [1/3] Kiểm tra kết nối và thư mục Git...

REM 2. Kiểm tra nếu đã có thư mục .git
if exist ".git" (
    echo     Thư mục hiện tại đã được khởi tạo Git.
    
    REM Thiết lập / Cập nhật remote origin
    git remote get-url origin >nul 2>&1
    if errorlevel 1 (
        echo     Đang cấu hình remote origin...
        git remote add origin https://github.com/CongCuong2709/web-phan-cong.git
    ) else (
        echo     Đang cập nhật URL remote origin...
        git remote set-url origin https://github.com/CongCuong2709/web-phan-cong.git
    )
    
    echo.
    echo [2/3] Đang tải mã nguồn mới nhất từ GitHub (git pull)...
    git fetch origin
    git pull origin main 2>nul || git pull origin master 2>nul || git pull

) else (
    echo     Thư mục hiện tại chưa có Git.
    echo.
    echo [2/3] Đang clone mã nguồn từ GitHub...
    git clone https://github.com/CongCuong2709/web-phan-cong.git .
)

if errorlevel 1 (
    echo.
    echo [!] CÓ LỖI XẢY RA khi lấy code từ GitHub!
    echo     Vui lòng kiểm tra lại kết nối mạng hoặc xung đột file local.
    echo.
    pause
    exit /b 1
)

echo.
echo [3/3] Hoàn tất! Mã nguồn đã được cập nhật mới nhất.
echo.
echo ============================================================================
echo   Bạn có thể chạy "start-server.bat" để khởi động ứng dụng.
echo ============================================================================
echo.

pause
endlocal
