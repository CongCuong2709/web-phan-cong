# reset-db.ps1 - Xóa DB để bootstrap schema mới
# An toàn: DB chỉ chứa data demo, đã backup ở backend/database.db.backup-before-refactor
$ErrorActionPreference = 'Stop'
$backend = Join-Path $PSScriptRoot 'backend'
$files = @('database.db', 'database.db-wal', 'database.db-shm')
foreach ($f in $files) {
    $p = Join-Path $backend $f
    if (Test-Path $p) {
        Remove-Item $p -Force
        Write-Host "Deleted: $f" -ForegroundColor Green
    } else {
        Write-Host "Skip (not found): $f" -ForegroundColor Gray
    }
}
Write-Host "`nDone. Backend sẽ tự bootstrap schema mới khi chạy 'npm run dev'." -ForegroundColor Cyan
