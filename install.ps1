# ══════════════════════════════════════════════════════════════
# 太空舰载系统 · OpenClaw Multi-Agent System 一键安装脚本 (Windows)
# PowerShell 版本 — 对应 install.sh
# ══════════════════════════════════════════════════════════════
#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$REPO_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$OC_HOME = Join-Path $env:USERPROFILE ".openclaw"
$OC_CFG = Join-Path $OC_HOME "openclaw.json"
$STATE_FILE = Join-Path $OC_HOME "jianzai-install-state.json"
$MANAGED_AGENTS = @("main","xingshu","lengjing","zhongji","yuanliu","wenshu","weikong","tanzhen","jiwu","xulie","tianyan")
$NON_MAIN_AGENTS = @("xingshu","lengjing","zhongji","yuanliu","wenshu","weikong","tanzhen","jiwu","xulie","tianyan")

function Write-Banner {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Blue
    Write-Host "║  🏛️  太空舰载系统 · OpenClaw Multi-Agent     ║" -ForegroundColor Blue
    Write-Host "║       安装向导 (Windows)                  ║" -ForegroundColor Blue
    Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Blue
    Write-Host ""
}

function Log   { param($msg) Write-Host "✅ $msg" -ForegroundColor Green }
function Warn  { param($msg) Write-Host "⚠️  $msg" -ForegroundColor Yellow }
function Error { param($msg) Write-Host "❌ $msg" -ForegroundColor Red }
function Info  { param($msg) Write-Host "ℹ️  $msg" -ForegroundColor Blue }

function Get-WorkspacePath {
    param([string]$AgentId)

    if ($AgentId -ne "main") {
        return (Join-Path $OC_HOME "workspace-$AgentId")
    }

    $pyScript = @"
import os
import pathlib
import sys

repo_dir = pathlib.Path(os.environ['REPO_DIR'])
sys.path.insert(0, str(repo_dir / 'scripts'))
from utils import resolve_workspace

print(resolve_workspace('main'))
"@
    return (& $global:PYTHON -c $pyScript).Trim()
}

function Write-InstallState {
    $pairs = @()
    foreach ($agent in $MANAGED_AGENTS) {
        $pairs += "$agent=$(Get-WorkspacePath $agent)"
    }
    $pairsText = [string]::Join("`n", $pairs)
    $agentsCsv = [string]::Join(",", $MANAGED_AGENTS)
    $backupDir = $script:BACKUP_DIR
    $pyScript = @"
import datetime
import json
import os
import pathlib

workspaces = {}
for line in os.environ.get('WORKSPACE_PAIRS', '').splitlines():
    if not line.strip():
        continue
    agent, workspace = line.split('=', 1)
    workspaces[agent] = workspace

state = {
    'installTag': 'jianzai-runtime',
    'installedAt': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    'backupDir': os.environ['BACKUP_DIR'],
    'managedAgents': [x for x in os.environ.get('MANAGED_AGENTS_CSV', '').split(',') if x],
    'mainWorkspace': workspaces.get('main', ''),
    'workspaces': workspaces,
}
state_path = pathlib.Path(os.environ['STATE_FILE'])
state_path.parent.mkdir(parents=True, exist_ok=True)
state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
print(state_path)
"@
    $env:WORKSPACE_PAIRS = $pairsText
    $env:MANAGED_AGENTS_CSV = $agentsCsv
    $env:BACKUP_DIR = $backupDir
    $env:STATE_FILE = $STATE_FILE
    & $global:PYTHON -c $pyScript | Out-Null
}

function Get-LocalSoulOverridePath {
    param([string]$WorkspacePath)

    $item = Get-ChildItem -LiteralPath $WorkspacePath -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ceq "SOUL.local.md" } |
        Select-Object -First 1
    if ($item) { return $item.FullName }
    return $null
}

function Get-ExactWorkspaceChild {
    param(
        [string]$WorkspacePath,
        [string]$Name
    )

    if (-not (Test-Path $WorkspacePath)) {
        return $null
    }

    return Get-ChildItem -LiteralPath $WorkspacePath -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ceq $Name } |
        Select-Object -First 1
}

function Backup-WorkspaceSnapshot {
    param(
        [string]$AgentId,
        [string]$SourcePath,
        [string]$DestinationPath
    )

    if (-not (Test-Path $SourcePath)) {
        return
    }

    if ($AgentId -eq "main") {
        Copy-Item -Path $SourcePath -Destination $DestinationPath -Recurse
        return
    }

    New-Item -ItemType Directory -Path $DestinationPath -Force | Out-Null
    Get-ChildItem -LiteralPath $SourcePath -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -cne "SOUL.md" } |
        ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $DestinationPath -Recurse -Force
        }
}

function Get-ComposedSoulContent {
    param(
        [string]$BaseSoulPath,
        [string]$WorkspacePath
    )

    $content = (Get-Content $BaseSoulPath -Raw).Replace("__REPO_DIR__", $REPO_DIR)
    $localPath = Get-LocalSoulOverridePath -WorkspacePath $WorkspacePath
    if (-not $localPath) {
        return $content
    }

    $localItem = Get-Item $localPath
    if ($localItem.Length -le 0) {
        return $content
    }

    $localName = Split-Path $localPath -Leaf
    $localContent = Get-Content $localPath -Raw
    $note = "`n`n<!-- LOCAL SOUL OVERRIDE: $localName -->`n## 本机覆盖层（自动合成）`n`n以下内容来自当前机器的 $localName，用于在同步仓库基线后保留本机自定义；若与前文冲突，以本节为准。`n`n"
    return $content.TrimEnd("`r", "`n") + $note + $localContent
}

# ── Step 0: 依赖检查 ──
function Check-Deps {
    Info "检查依赖..."

    $oc = Get-Command openclaw -ErrorAction SilentlyContinue
    if (-not $oc) {
        Error "未找到 openclaw CLI。此脚本只负责把仓库配置部署到 OpenClaw 运行时。"
        Info "请先安装并初始化 OpenClaw: https://openclaw.ai"
        Info "若当前只是在仓库内整理 Agent 基线，可直接编辑 agents/<id>/SOUL.md。"
        exit 1
    }
    Log "OpenClaw CLI: OK"

    $py = Get-Command python -ErrorAction SilentlyContinue
    if (-not $py) {
        $py = Get-Command python3 -ErrorAction SilentlyContinue
    }
    if (-not $py) {
        Error "未找到 python3 或 python"
        exit 1
    }
    $global:PYTHON = $py.Source
    Log "Python: $($global:PYTHON)"

    if (-not (Test-Path $OC_CFG)) {
        Error "未找到 openclaw.json。请先运行 openclaw 完成初始化。"
        Info "初始化完成后重新运行安装脚本，脚本会把仓库 SOUL.md 与本机 SOUL.local.md 合成为运行态 SOUL.md。"
        exit 1
    }
    Log "openclaw.json: $OC_CFG"
}

# ── Step 0.5: 备份已有 Agent 数据 ──
function Backup-Existing {
    Info "创建安装前备份..."
    $ts = Get-Date -Format "yyyyMMdd-HHmmss"
    $script:BACKUP_DIR = Join-Path $OC_HOME "backups\jianzai-install-$ts"
    New-Item -ItemType Directory -Path (Join-Path $script:BACKUP_DIR "workspaces") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $script:BACKUP_DIR "agents") -Force | Out-Null

    if (Test-Path $OC_CFG) {
        Copy-Item $OC_CFG (Join-Path $script:BACKUP_DIR "openclaw.json")
    }

    foreach ($agent in $MANAGED_AGENTS) {
        $ws = Get-WorkspacePath $agent
        if (Test-Path $ws) {
            Backup-WorkspaceSnapshot -AgentId $agent -SourcePath $ws -DestinationPath (Join-Path $script:BACKUP_DIR "workspaces\$agent")
        }

        $agentDir = Join-Path $OC_HOME "agents\$agent"
        if (Test-Path $agentDir) {
            Copy-Item -Path $agentDir -Destination (Join-Path $script:BACKUP_DIR "agents\$agent") -Recurse
        }
    }

    Log "安装前备份完成: $script:BACKUP_DIR"
}

# ── Step 1: 创建 Workspace ──
function Create-Workspaces {
    Info "创建 Agent Workspace..."

    foreach ($agent in $MANAGED_AGENTS) {
        $ws = Get-WorkspacePath $agent
        $upperSoulItem = Get-ExactWorkspaceChild -WorkspacePath $ws -Name "SOUL.md"
        New-Item -ItemType Directory -Path $ws -Force | Out-Null
        if ($agent -ne "main") {
            New-Item -ItemType Directory -Path (Join-Path $ws "skills") -Force | Out-Null
        }

        $soulSrc = Join-Path $REPO_DIR "agents\$agent\SOUL.md"
        $soulDst = Join-Path $ws "SOUL.md"
        if (Test-Path $soulSrc) {
            $ts = Get-Date -Format "yyyyMMdd-HHmmss"
            if ($agent -eq "main" -and $upperSoulItem) {
                Copy-Item $upperSoulItem.FullName "$($upperSoulItem.FullName).bak.$ts"
                Warn "已备份旧 SOUL.md → $($upperSoulItem.FullName).bak.$ts"
            }
            $content = Get-ComposedSoulContent -BaseSoulPath $soulSrc -WorkspacePath $ws
            Set-Content -Path $soulDst -Value $content -Encoding UTF8
            if (Get-LocalSoulOverridePath -WorkspacePath $ws) {
                Info "检测到本机覆盖层，将与仓库基线合成输出: $ws"
            }
        }
        Log "Workspace 已创建: $ws"

        if ($agent -eq "main") {
            continue
        }

        $agentsMd = @"
# AGENTS.md · 工作协议

1. 接到任务先回复"已接令"。
2. 输出必须包含：任务ID、结果、证据/文件路径、阻塞项。
3. 需要协作时，回复中继请求转派，不跨部直连。
4. 涉及删除/外发动作必须明确标注并等待批准。
"@
        Set-Content -Path (Join-Path $ws "AGENTS.md") -Value $agentsMd -Encoding UTF8
    }
}

# ── Step 2: 注册 Agents ──
function Register-Agents {
    Info "注册太空舰载系统 Agents..."

    $ts = Get-Date -Format "yyyyMMdd-HHmmss"
    Copy-Item $OC_CFG "$OC_CFG.bak.jianzai-$ts"
    Log "已备份配置: $OC_CFG.bak.*"

    $pyScript = @"
import json, pathlib, os

cfg_path = pathlib.Path(os.environ['USERPROFILE']) / '.openclaw' / 'openclaw.json'
cfg = json.loads(cfg_path.read_text(encoding='utf-8'))

canonical_agents = [
    {'id': 'main', 'subagents': {'allowAgents': ['xingshu']}},
    {'id': 'xingshu', 'subagents': {'allowAgents': ['lengjing', 'zhongji']}},
    {'id': 'lengjing', 'subagents': {'allowAgents': ['zhongji', 'xingshu']}},
    {'id': 'zhongji', 'subagents': {'allowAgents': ['xingshu', 'lengjing', 'yuanliu', 'wenshu', 'weikong', 'tanzhen', 'jiwu', 'xulie']}},
    {'id': 'yuanliu', 'subagents': {'allowAgents': ['zhongji']}},
    {'id': 'wenshu', 'subagents': {'allowAgents': ['zhongji']}},
    {'id': 'weikong', 'subagents': {'allowAgents': ['zhongji']}},
    {'id': 'tanzhen', 'subagents': {'allowAgents': ['zhongji']}},
    {'id': 'jiwu', 'subagents': {'allowAgents': ['zhongji']}},
    {'id': 'xulie', 'subagents': {'allowAgents': ['zhongji']}},
    {'id': 'tianyan', 'subagents': {'allowAgents': []}},
]

def resolve_workspace(agent_id, agents_list):
    for item in agents_list:
        if item.get('id') == agent_id and item.get('workspace'):
            return item['workspace']
    home = pathlib.Path(os.environ['USERPROFILE']) / '.openclaw'
    if agent_id == 'main':
        return str(home / 'workspace')
    return str(home / f'workspace-{agent_id}')

agents_cfg = cfg.setdefault('agents', {})
agents_list = list(agents_cfg.get('list', []))
existing = {a['id']: a for a in agents_list if a.get('id')}

added = 0
updated = 0
for ag in canonical_agents:
    ag_id = ag['id']
    desired = {
        'id': ag_id,
        'workspace': resolve_workspace(ag_id, agents_list),
        **{k:v for k,v in ag.items() if k!='id'}
    }
    if ag_id in existing:
        current = existing[ag_id]
        changed = False
        if current.get('subagents', {}) != desired['subagents']:
            current['subagents'] = desired['subagents']
            changed = True
        if not current.get('workspace'):
            current['workspace'] = desired['workspace']
            changed = True
        if changed:
            updated += 1
            print(f'  ~ updated: {ag_id}')
        else:
            print(f'  ~ exists: {ag_id}')
    else:
        entry = desired
        agents_list.append(entry)
        existing[ag_id] = entry
        added += 1
        print(f'  + added: {ag_id}')

agents_cfg['list'] = agents_list

bindings = cfg.get('bindings', [])
for b in bindings:
    match = b.get('match', {})
    if isinstance(match, dict) and 'pattern' in match:
        del match['pattern']
        print(f'  cleaned invalid pattern from binding: {b.get("agentId", "?")}')

cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Done: {added} agents added, {updated} agents updated')
"@
    & $global:PYTHON -c $pyScript
    Log "Agents 注册完成"
}

# ── Step 3: 初始化 Data ──
function Init-Data {
    Info "初始化数据目录..."
    $dataDir = Join-Path $REPO_DIR "data"
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

    foreach ($f in @("live_status.json","agent_config.json","model_change_log.json")) {
        $fp = Join-Path $dataDir $f
        if (-not (Test-Path $fp)) { Set-Content $fp "{}" -Encoding UTF8 }
    }
    Set-Content (Join-Path $dataDir "pending_model_changes.json") "[]" -Encoding UTF8
    Log "数据目录初始化完成"
}

# ── Step 3.3: 创建 data/scripts 目录连接 (Junction) ──
function Link-Resources {
    Info "创建 data/scripts 目录连接..."
    $linked = 0
    foreach ($agent in $NON_MAIN_AGENTS) {
        $ws = Get-WorkspacePath $agent
        New-Item -ItemType Directory -Path $ws -Force | Out-Null

        # data 目录
        $wsData = Join-Path $ws "data"
        $srcData = Join-Path $REPO_DIR "data"
        if (-not (Test-Path $wsData)) {
            cmd /c mklink /J "$wsData" "$srcData" | Out-Null
            $linked++
        } elseif (-not ((Get-Item $wsData).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            $ts = Get-Date -Format "yyyyMMdd-HHmmss"
            Rename-Item $wsData "$wsData.bak.$ts"
            cmd /c mklink /J "$wsData" "$srcData" | Out-Null
            $linked++
        }

        # scripts 目录
        $wsScripts = Join-Path $ws "scripts"
        $srcScripts = Join-Path $REPO_DIR "scripts"
        if (-not (Test-Path $wsScripts)) {
            cmd /c mklink /J "$wsScripts" "$srcScripts" | Out-Null
            $linked++
        } elseif (-not ((Get-Item $wsScripts).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            $ts = Get-Date -Format "yyyyMMdd-HHmmss"
            Rename-Item $wsScripts "$wsScripts.bak.$ts"
            cmd /c mklink /J "$wsScripts" "$srcScripts" | Out-Null
            $linked++
        }
    }
    Log "已创建 $linked 个目录连接 (data/scripts → 项目目录)"
}

# ── Step 3.5: 设置 Agent 间通信可见性 ──
function Setup-Visibility {
    Info "配置 Agent 间消息可见性..."
    try {
        openclaw config set tools.sessions.visibility all 2>$null
        Log "已设置 tools.sessions.visibility=all"
    } catch {
        Warn "设置 visibility 失败，请手动执行: openclaw config set tools.sessions.visibility all"
    }
}

# ── Step 4: 构建前端 ──
function Build-Frontend {
    Info "构建 React 前端..."
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Warn "未找到 node，跳过前端构建。"
        Warn "请安装 Node.js 18+ 后运行: cd edict\frontend && npm install && npm run build"
        return
    }
    $pkgJson = Join-Path $REPO_DIR "edict\frontend\package.json"
    if (Test-Path $pkgJson) {
        Push-Location (Join-Path $REPO_DIR "edict\frontend")
        npm install --silent 2>$null
        npm run build 2>$null
        Pop-Location
        $indexHtml = Join-Path $REPO_DIR "dashboard\dist\index.html"
        if (Test-Path $indexHtml) {
            Log "前端构建完成: dashboard\dist\"
        } else {
            Warn "前端构建可能失败，请手动检查"
        }
    }
}

# ── Step 5: 首次数据同步 ──
function First-Sync {
    Info "执行首次数据同步..."
    Push-Location $REPO_DIR
    $env:REPO_DIR = $REPO_DIR
    try { & $global:PYTHON scripts/sync_agent_config.py } catch { Warn "sync_agent_config 有警告" }
    try { & $global:PYTHON scripts/sync_nodes_stats.py } catch { Warn "sync_nodes_stats 有警告" }
    try { & $global:PYTHON scripts/refresh_live_data.py } catch { Warn "refresh_live_data 有警告" }
    Pop-Location
    Log "首次同步完成"
}

# ── Step 6: 重启 Gateway ──
function Restart-Gateway {
    Info "重启 OpenClaw Gateway..."
    try {
        openclaw gateway restart 2>$null
        Log "Gateway 重启成功"
    } catch {
        Warn "Gateway 重启失败，请手动重启: openclaw gateway restart"
    }
}

# ── Main ──
Write-Banner
Check-Deps
Backup-Existing
Create-Workspaces
Register-Agents
Init-Data
Link-Resources
Setup-Visibility
Write-InstallState
Build-Frontend
First-Sync
Restart-Gateway

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  🎉  太空舰载系统安装完成！                          ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "下一步："
Write-Host "  1. 配置 API Key（如尚未配置）:"
Write-Host "     openclaw agents add main     # 按提示输入 Anthropic API Key"
Write-Host "     .\install.ps1                 # 重新运行以同步到所有 Agent"
Write-Host "  2. 启动数据刷新循环:  bash scripts/run_loop.sh"
Write-Host "  3. 启动看板服务器:    python dashboard/server.py"
Write-Host "  4. 打开看板:          http://127.0.0.1:7891"
Write-Host "  5. 如需卸载:          .\uninstall.ps1"
Write-Host ""
Warn "首次安装必须配置 API Key，否则 Agent 会报错"
Info "文档: docs/getting-started.md"
