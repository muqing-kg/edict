#!/bin/bash
# ══════════════════════════════════════════════════════════════
# 太空舰载系统 · OpenClaw Multi-Agent System 一键安装脚本
# ══════════════════════════════════════════════════════════════
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OC_HOME="$HOME/.openclaw"
OC_CFG="$OC_HOME/openclaw.json"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

banner() {
  echo ""
  echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║  🏛️  太空舰载系统 · OpenClaw Multi-Agent    ║${NC}"
  echo -e "${BLUE}║       安装向导                            ║${NC}"
  echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
  echo ""
}

log()   { echo -e "${GREEN}✅ $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠️  $1${NC}"; }
error() { echo -e "${RED}❌ $1${NC}"; }
info()  { echo -e "${BLUE}ℹ️  $1${NC}"; }

compose_soul_content() {
  local base_src="$1"
  local ws_dir="$2"
  local local_upper="$ws_dir/SOUL.local.md"
  local local_lower="$ws_dir/soul.local.md"
  local local_src=""
  local escaped_repo_dir=""

  if [ -f "$local_upper" ]; then
    local_src="$local_upper"
  elif [ -f "$local_lower" ]; then
    local_src="$local_lower"
  fi

  escaped_repo_dir=$(printf '%s' "$REPO_DIR" | sed 's/[&|]/\\&/g')
  sed "s|__REPO_DIR__|$escaped_repo_dir|g" "$base_src"

  if [ -n "$local_src" ] && [ -s "$local_src" ]; then
    printf '\n\n<!-- LOCAL SOUL OVERRIDE: %s -->\n' "$(basename "$local_src")"
    printf '## 本机覆盖层（自动合成）\n\n'
    printf '以下内容来自当前机器的 `%s`，用于在同步仓库基线后保留本机自定义；若与前文冲突，以本节为准。\n\n' "$(basename "$local_src")"
    cat "$local_src"
  fi
}

# ── Step 0: 依赖检查 ──────────────────────────────────────────
check_deps() {
  info "检查依赖..."
  
  if ! command -v openclaw &>/dev/null; then
    error "未找到 openclaw CLI。此脚本只负责把仓库配置部署到 OpenClaw 运行时。"
    info "请先安装并初始化 OpenClaw: https://openclaw.ai"
    info "若当前只是在仓库内整理 Agent 基线，可直接编辑 agents/<id>/SOUL.md。"
    exit 1
  fi
  log "OpenClaw CLI: $(openclaw --version 2>/dev/null || echo 'OK')"

  if ! command -v python3 &>/dev/null; then
    error "未找到 python3"
    exit 1
  fi
  log "Python3: $(python3 --version)"

  if [ ! -f "$OC_CFG" ]; then
    error "未找到 openclaw.json。请先运行 openclaw 完成初始化。"
    info "初始化完成后重新运行安装脚本，脚本会把仓库 SOUL.md 与本机 SOUL.local.md 合成为运行态 SOUL.md / soul.md。"
    exit 1
  fi
  log "openclaw.json: $OC_CFG"
}

# ── Step 0.5: 备份已有 Agent 数据 ──────────────────────────────
backup_existing() {
  AGENTS_DIR="$OC_HOME"
  BACKUP_DIR="$OC_HOME/backups/pre-install-$(date +%Y%m%d-%H%M%S)"
  HAS_EXISTING=false

  # 检查是否有已存在的 workspace
  for d in "$AGENTS_DIR"/workspace-*/; do
    if [ -d "$d" ]; then
      HAS_EXISTING=true
      break
    fi
  done

  if $HAS_EXISTING; then
    info "检测到已有 Agent Workspace，自动备份中..."
    mkdir -p "$BACKUP_DIR"

    # 备份所有 workspace 目录
    for d in "$AGENTS_DIR"/workspace-*/; do
      if [ -d "$d" ]; then
        ws_name=$(basename "$d")
        cp -R "$d" "$BACKUP_DIR/$ws_name"
      fi
    done

    # 备份 openclaw.json
    if [ -f "$OC_CFG" ]; then
      cp "$OC_CFG" "$BACKUP_DIR/openclaw.json"
    fi

    # 备份 agents 目录（agent 注册信息）
    if [ -d "$AGENTS_DIR/agents" ]; then
      cp -R "$AGENTS_DIR/agents" "$BACKUP_DIR/agents"
    fi

    log "已备份到: $BACKUP_DIR"
    info "如需恢复，运行: cp -R $BACKUP_DIR/workspace-* $AGENTS_DIR/"
  fi
}

# ── Step 1: 创建 Workspace ──────────────────────────────────
create_workspaces() {
  info "创建 Agent Workspace..."
  
  AGENTS=(taizi zhongshu menxia shangshu hubu libu bingbu xingbu gongbu libu_hr zaochao)
  for agent in "${AGENTS[@]}"; do
    ws="$OC_HOME/workspace-$agent"
    mkdir -p "$ws/skills"
    soul_src="$REPO_DIR/agents/$agent/SOUL.md"
    soul_dst="$ws/SOUL.md"
    soul_compat_dst="$ws/soul.md"
    if [ -f "$soul_src" ]; then
      ts=$(date +%Y%m%d-%H%M%S)
      if [ -f "$soul_dst" ]; then
        # 以 SOUL.md 为主文件，备份后再覆盖
        cp "$soul_dst" "$soul_dst.bak.$ts"
        warn "已备份旧 SOUL.md → $soul_dst.bak.$ts"
      elif [ -f "$soul_compat_dst" ]; then
        # 兼容历史只存在 soul.md 的情况
        cp "$soul_compat_dst" "$soul_compat_dst.bak.$ts"
        warn "检测到旧版 soul.md，已备份 → $soul_compat_dst.bak.$ts"
      fi

      tmp_soul=$(mktemp)
      compose_soul_content "$soul_src" "$ws" > "$tmp_soul"
      cp "$tmp_soul" "$soul_dst"
      # 兼容镜像：避免旧逻辑读取 soul.md 时丢失更新
      cp "$tmp_soul" "$soul_compat_dst"
      rm -f "$tmp_soul"

      if [ -f "$ws/SOUL.local.md" ] || [ -f "$ws/soul.local.md" ]; then
        info "检测到本机覆盖层，将与仓库基线合成输出: $ws"
      fi
    fi
    log "Workspace 已创建: $ws"
  done

  # 通用 AGENTS.md（工作协议）
  for agent in "${AGENTS[@]}"; do
    cat > "$OC_HOME/workspace-$agent/AGENTS.md" << 'AGENTS_EOF'
# AGENTS.md · 工作协议

1. 接到任务先回复"已接令"。
2. 输出必须包含：任务ID、结果、证据/文件路径、阻塞项。
3. 需要协作时，回复中继请求转派，不跨部直连。
4. 涉及删除/外发动作必须明确标注并等待批准。
AGENTS_EOF
  done
}

# ── Step 2: 注册 Agents ─────────────────────────────────────
register_agents() {
  info "注册太空舰载系统 Agents..."

  # 备份配置
  cp "$OC_CFG" "$OC_CFG.bak.sansheng-$(date +%Y%m%d-%H%M%S)"
  log "已备份配置: $OC_CFG.bak.*"

  python3 << 'PYEOF'
import json, pathlib, sys

cfg_path = pathlib.Path.home() / '.openclaw' / 'openclaw.json'
cfg = json.loads(cfg_path.read_text())

AGENTS = [
  {"id": "taizi",    "subagents": {"allowAgents": ["zhongshu"]}},
    {"id": "zhongshu", "subagents": {"allowAgents": ["menxia", "shangshu"]}},
    {"id": "menxia",   "subagents": {"allowAgents": ["shangshu", "zhongshu"]}},
  {"id": "shangshu", "subagents": {"allowAgents": ["zhongshu", "menxia", "hubu", "libu", "bingbu", "xingbu", "gongbu", "libu_hr"]}},
    {"id": "hubu",     "subagents": {"allowAgents": ["shangshu"]}},
    {"id": "libu",     "subagents": {"allowAgents": ["shangshu"]}},
    {"id": "bingbu",   "subagents": {"allowAgents": ["shangshu"]}},
    {"id": "xingbu",   "subagents": {"allowAgents": ["shangshu"]}},
    {"id": "gongbu",   "subagents": {"allowAgents": ["shangshu"]}},
  {"id": "libu_hr",  "subagents": {"allowAgents": ["shangshu"]}},
  {"id": "zaochao",  "subagents": {"allowAgents": []}},
]

agents_cfg = cfg.setdefault('agents', {})
agents_list = agents_cfg.get('list', [])
existing_ids = {a['id'] for a in agents_list}

added = 0
for ag in AGENTS:
    ag_id = ag['id']
    ws = str(pathlib.Path.home() / f'.openclaw/workspace-{ag_id}')
    if ag_id not in existing_ids:
        entry = {'id': ag_id, 'workspace': ws, **{k:v for k,v in ag.items() if k!='id'}}
        agents_list.append(entry)
        added += 1
        print(f'  + added: {ag_id}')
    else:
        print(f'  ~ exists: {ag_id} (skipped)')

agents_cfg['list'] = agents_list

# Fix #142: 清理 bindings 中的非法字段（pattern 不被 gateway 支持）
bindings = cfg.get('bindings', [])
cleaned = 0
for b in bindings:
    match = b.get('match', {})
    if isinstance(match, dict) and 'pattern' in match:
        del match['pattern']
        cleaned += 1
        print(f'  🧹 cleaned invalid "pattern" from binding: {b.get("agentId", "?")}')
if cleaned:
    print(f'Cleaned {cleaned} invalid binding field(s)')

cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2))
print(f'Done: {added} agents added')
PYEOF

  log "Agents 注册完成"
}

# ── Step 3: 初始化 Data ─────────────────────────────────────
init_data() {
  info "初始化数据目录..."
  
  mkdir -p "$REPO_DIR/data"
  
  # 初始化空文件
  for f in live_status.json agent_config.json model_change_log.json; do
    if [ ! -f "$REPO_DIR/data/$f" ]; then
      echo '{}' > "$REPO_DIR/data/$f"
    fi
  done
  echo '[]' > "$REPO_DIR/data/pending_model_changes.json"

  # 初始任务文件
  if [ ! -f "$REPO_DIR/data/tasks_source.json" ]; then
    python3 << 'PYEOF'
import json, pathlib
tasks = [
    {
        "id": "JJC-DEMO-001",
        "title": "🎉 系统初始化完成",
        "official": "机务",
        "org": "机务",
        "state": "Done",
        "now": "系统已就绪",
        "eta": "-",
        "block": "无",
        "output": "",
        "ac": "系统正常运行",
        "flow_log": [
            {"at": "2024-01-01T00:00:00Z", "from": "主人", "to": "星枢", "remark": "下发系统初始化指令"},
            {"at": "2024-01-01T00:01:00Z", "from": "星枢", "to": "棱镜", "remark": "规划方案提交校核"},
            {"at": "2024-01-01T00:02:00Z", "from": "棱镜", "to": "中继", "remark": "✅ 通过校核"},
            {"at": "2024-01-01T00:03:00Z", "from": "中继", "to": "机务", "remark": "路由：系统初始化"},
            {"at": "2024-01-01T00:04:00Z", "from": "机务", "to": "中继", "remark": "✅ 完成"},
        ]
    }
]
import os
data_dir = pathlib.Path(os.environ.get('REPO_DIR', '.')) / 'data'
data_dir.mkdir(exist_ok=True)
(data_dir / 'tasks_source.json').write_text(json.dumps(tasks, ensure_ascii=False, indent=2))
print('tasks_source.json 已初始化')
PYEOF
  fi

  log "数据目录初始化完成: $REPO_DIR/data"
}

# ── Step 3.3: 创建 data 软链接确保数据一致 (Fix #88) ─────────
link_resources() {
  info "创建 data/scripts 软链接以确保 Agent 数据一致..."
  
  AGENTS=(taizi zhongshu menxia shangshu hubu libu bingbu xingbu gongbu libu_hr zaochao)
  LINKED=0
  for agent in "${AGENTS[@]}"; do
    ws="$OC_HOME/workspace-$agent"
    mkdir -p "$ws"

    # 软链接 data 目录：确保各 agent 读写同一份 tasks_source.json
    ws_data="$ws/data"
    if [ -L "$ws_data" ]; then
      : # 已是软链接，跳过
    elif [ -d "$ws_data" ]; then
      # 已有 data 目录（非符号链接），备份后替换
      mv "$ws_data" "${ws_data}.bak.$(date +%Y%m%d-%H%M%S)"
      ln -s "$REPO_DIR/data" "$ws_data"
      LINKED=$((LINKED + 1))
    else
      ln -s "$REPO_DIR/data" "$ws_data"
      LINKED=$((LINKED + 1))
    fi

    # 软链接 scripts 目录
    ws_scripts="$ws/scripts"
    if [ -L "$ws_scripts" ]; then
      : # 已是软链接
    elif [ -d "$ws_scripts" ]; then
      mv "$ws_scripts" "${ws_scripts}.bak.$(date +%Y%m%d-%H%M%S)"
      ln -s "$REPO_DIR/scripts" "$ws_scripts"
      LINKED=$((LINKED + 1))
    else
      ln -s "$REPO_DIR/scripts" "$ws_scripts"
      LINKED=$((LINKED + 1))
    fi
  done

  # Legacy: workspace-main
  ws_main="$OC_HOME/workspace-main"
  if [ -d "$ws_main" ]; then
    for target in data scripts; do
      link_path="$ws_main/$target"
      if [ ! -L "$link_path" ]; then
        [ -d "$link_path" ] && mv "$link_path" "${link_path}.bak.$(date +%Y%m%d-%H%M%S)"
        ln -s "$REPO_DIR/$target" "$link_path"
        LINKED=$((LINKED + 1))
      fi
    done
  fi

  log "已创建 $LINKED 个软链接（data/scripts → 项目目录）"
}

# ── Step 3.5: 设置 Agent 间通信可见性 (Fix #83) ──────────────
setup_visibility() {
  info "配置 Agent 间消息可见性..."
  if openclaw config set tools.sessions.visibility all 2>/dev/null; then
    log "已设置 tools.sessions.visibility=all（Agent 间可互相通信）"
  else
    warn "设置 visibility 失败（可能 openclaw 版本不支持），请手动执行:"
    echo "    openclaw config set tools.sessions.visibility all"
  fi
}

# ── Step 3.5b: 同步 API Key 到所有 Agent ──────────────────────────
sync_auth() {
  info "同步 API Key 到所有 Agent..."

  # 找到 main agent 的 auth-profiles.json（OpenClaw 主密钥存储）
  MAIN_AUTH="$OC_HOME/agents/main/agent/auth-profiles.json"
  if [ ! -f "$MAIN_AUTH" ]; then
    # 尝试其他可能的位置
    MAIN_AUTH=$(find "$OC_HOME/agents" -name auth-profiles.json -maxdepth 3 2>/dev/null | head -1)
  fi

  if [ -z "$MAIN_AUTH" ] || [ ! -f "$MAIN_AUTH" ]; then
    warn "未找到已有的 auth-profiles.json"
    warn "请先为任意 Agent 配置 API Key:"
    echo "    openclaw agents add taizi"
    echo "  然后重新运行 install.sh，或手动执行:"
    echo "    bash install.sh --sync-auth"
    return
  fi

  # 检查文件内容是否有效（非空 JSON）
  if ! python3 -c "import json; d=json.load(open('$MAIN_AUTH')); assert d" 2>/dev/null; then
    warn "auth-profiles.json 为空或无效，请先配置 API Key:"
    echo "    openclaw agents add taizi"
    return
  fi

  AGENTS=(taizi zhongshu menxia shangshu hubu libu bingbu xingbu gongbu libu_hr zaochao)
  SYNCED=0
  for agent in "${AGENTS[@]}"; do
    AGENT_DIR="$OC_HOME/agents/$agent/agent"
    if [ -d "$AGENT_DIR" ] || mkdir -p "$AGENT_DIR" 2>/dev/null; then
      cp "$MAIN_AUTH" "$AGENT_DIR/auth-profiles.json"
      SYNCED=$((SYNCED + 1))
    fi
  done

  log "API Key 已同步到 $SYNCED 个 Agent"
  info "来源: $MAIN_AUTH"
}

# ── Step 4: 构建前端 ──────────────────────────────────────────
build_frontend() {
  info "构建 React 前端..."

  if ! command -v node &>/dev/null; then
    warn "未找到 node，跳过前端构建。看板将使用预构建版本（如果存在）"
    warn "请安装 Node.js 18+ 后运行: cd edict/frontend && npm install && npm run build"
    return
  fi

  if [ -f "$REPO_DIR/edict/frontend/package.json" ]; then
    cd "$REPO_DIR/edict/frontend"
    npm install --silent 2>/dev/null || npm install
    npm run build 2>/dev/null
    cd "$REPO_DIR"
    if [ -f "$REPO_DIR/dashboard/dist/index.html" ]; then
      log "前端构建完成: dashboard/dist/"
    else
      warn "前端构建可能失败，请手动检查"
    fi
  else
    warn "未找到 edict/frontend/package.json，跳过前端构建"
  fi
}

# ── Step 5: 首次数据同步 ────────────────────────────────────
first_sync() {
  info "执行首次数据同步..."
  cd "$REPO_DIR"
  
  REPO_DIR="$REPO_DIR" python3 scripts/sync_agent_config.py || warn "sync_agent_config 有警告"
  python3 scripts/sync_officials_stats.py || warn "sync_officials_stats 有警告"
  python3 scripts/refresh_live_data.py || warn "refresh_live_data 有警告"
  
  log "首次同步完成"
}

# ── Step 6: 重启 Gateway ────────────────────────────────────
restart_gateway() {
  info "重启 OpenClaw Gateway..."
  if openclaw gateway restart 2>/dev/null; then
    log "Gateway 重启成功"
  else
    warn "Gateway 重启失败，请手动重启：openclaw gateway restart"
  fi
}

# ── Main ────────────────────────────────────────────────────
banner
check_deps
backup_existing
create_workspaces
register_agents
init_data
link_resources
setup_visibility
sync_auth
build_frontend
first_sync
restart_gateway

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  🎉  太空舰载系统安装完成！                          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo "下一步："
echo "  1. 配置 API Key（如尚未配置）:"
echo "     openclaw agents add taizi     # 按提示输入 Anthropic API Key"
echo "     ./install.sh                  # 重新运行以同步到所有 Agent"
echo "  2. 启动数据刷新循环:  bash scripts/run_loop.sh &"
echo "  3. 启动看板服务器:    python3 dashboard/server.py"
echo "  4. 打开看板:          http://127.0.0.1:7891"
echo ""
warn "首次安装必须配置 API Key，否则 Agent 会报错"
info "文档: docs/getting-started.md"
