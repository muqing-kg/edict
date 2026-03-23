#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$REPO_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Get-Command python3 -ErrorAction SilentlyContinue
if (-not $py) {
    $py = Get-Command python -ErrorAction SilentlyContinue
}
if (-not $py) {
    throw "未找到 python3 或 python"
}

Write-Host "开始卸载太空舰载系统运行时..."
& $py.Source (Join-Path $REPO_DIR "scripts\uninstall_openclaw_runtime.py")

$oc = Get-Command openclaw -ErrorAction SilentlyContinue
if ($oc) {
    try {
        openclaw gateway restart 2>$null
        Write-Host "✅ Gateway 已重启" -ForegroundColor Green
    } catch {
        Write-Host "⚠️  Gateway 重启失败，请手动执行: openclaw gateway restart" -ForegroundColor Yellow
    }
}
