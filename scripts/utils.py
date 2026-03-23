#!/usr/bin/env python3
"""
太空舰载系统 · 公共工具函数
避免 read_json / now_iso 等基础函数在多个脚本中重复定义
"""
import json
import pathlib
import datetime


OPENCLAW_HOME = pathlib.Path.home() / '.openclaw'
OPENCLAW_CFG = OPENCLAW_HOME / 'openclaw.json'


def read_json(path, default=None):
    """安全读取 JSON 文件，失败返回 default"""
    try:
        return json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    except Exception:
        return default if default is not None else {}


def now_iso():
    """返回 UTC ISO 8601 时间字符串（末尾 Z）"""
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')


def today_str(fmt='%Y%m%d'):
    """返回今天日期字符串，默认 YYYYMMDD"""
    return datetime.date.today().strftime(fmt)


def safe_name(s: str) -> bool:
    """检查名称是否只含安全字符（字母、数字、下划线、连字符、中文）"""
    import re
    return bool(re.match(r'^[a-zA-Z0-9_\-\u4e00-\u9fff]+$', s))


def load_openclaw_cfg():
    """读取 OpenClaw 配置，失败时返回空 dict。"""
    return read_json(OPENCLAW_CFG, {})


def default_workspace(agent_id: str) -> pathlib.Path:
    """返回默认 workspace 路径。`main` 优先使用真实入口目录 `workspace`。"""
    if agent_id == 'main':
        return OPENCLAW_HOME / 'workspace'
    return OPENCLAW_HOME / f'workspace-{agent_id}'


def workspace_candidates(agent_id: str):
    """返回 agent 可能的 workspace 路径候选，按优先级排序。"""
    if agent_id == 'main':
        return [OPENCLAW_HOME / 'workspace']
    return [OPENCLAW_HOME / f'workspace-{agent_id}']


def resolve_workspace(agent_id: str, cfg=None, must_exist: bool = False) -> pathlib.Path:
    """解析 agent 的真实 workspace。

    优先顺序：
    1. openclaw.json 中 agents.list[*].workspace
    2. main -> ~/.openclaw/workspace
    3. 其他 agent -> ~/.openclaw/workspace-<id>
    """
    if cfg is None:
        cfg = load_openclaw_cfg()

    agents = cfg.get('agents', {}).get('list', []) if isinstance(cfg, dict) else []
    for agent in agents:
        if agent.get('id') != agent_id:
            continue
        workspace = str(agent.get('workspace', '')).strip()
        if not workspace:
            break
        resolved = pathlib.Path(workspace).expanduser()
        if not must_exist or resolved.exists():
            return resolved

    for candidate in workspace_candidates(agent_id):
        if not must_exist or candidate.exists():
            return candidate

    return default_workspace(agent_id)


def resolve_workspaces(agent_ids, cfg=None):
    """批量解析 workspace。"""
    if cfg is None:
        cfg = load_openclaw_cfg()
    return {agent_id: resolve_workspace(agent_id, cfg=cfg) for agent_id in agent_ids}


def discover_workspaces(cfg=None):
    """发现当前运行时中所有已知 workspace。

    先信任 openclaw.json，其次补充磁盘上存在的默认目录。
    """
    if cfg is None:
        cfg = load_openclaw_cfg()

    discovered = {}
    agents = cfg.get('agents', {}).get('list', []) if isinstance(cfg, dict) else []
    for agent in agents:
        agent_id = agent.get('id')
        workspace = str(agent.get('workspace', '')).strip()
        if agent_id and workspace:
            discovered[agent_id] = pathlib.Path(workspace).expanduser()

    main_default = OPENCLAW_HOME / 'workspace'
    if main_default.exists():
        discovered.setdefault('main', main_default)

    for ws_dir in OPENCLAW_HOME.glob('workspace-*'):
        agent_id = ws_dir.name.replace('workspace-', '', 1)
        if agent_id:
            discovered.setdefault(agent_id, ws_dir)

    return discovered


def validate_url(url: str, allowed_schemes=('https',), allowed_domains=None) -> bool:
    """校验 URL 合法性，防 SSRF"""
    from urllib.parse import urlparse
    try:
        parsed = urlparse(url)
        if parsed.scheme not in allowed_schemes:
            return False
        if allowed_domains and parsed.hostname not in allowed_domains:
            return False
        if not parsed.hostname:
            return False
        # 禁止内网地址
        import ipaddress
        try:
            ip = ipaddress.ip_address(parsed.hostname)
            if ip.is_private or ip.is_loopback or ip.is_reserved:
                return False
        except ValueError:
            pass  # hostname 不是 IP，放行
        return True
    except Exception:
        return False
