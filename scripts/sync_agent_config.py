#!/usr/bin/env python3
"""
同步 openclaw.json 中的 agent 配置 → data/agent_config.json
支持自动发现 agent workspace 下的 Skills 目录
"""
import json
import pathlib
import datetime
import logging
from typing import Optional
from file_lock import atomic_json_write
from utils import load_openclaw_cfg, resolve_workspace

log = logging.getLogger('sync_agent_config')
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(name)s] %(message)s', datefmt='%H:%M:%S')

# Auto-detect project root (parent of scripts/)
BASE = pathlib.Path(__file__).parent.parent
DATA = BASE / 'data'

ID_LABEL = {
    'main': {'label': '云霄', 'role': '入口分拣核心', 'duty': '输入分拣与需求提炼', 'emoji': '🧭'},
    'xingshu': {'label': '星枢', 'role': '规划与起草中枢', 'duty': '方案规划与执行路径起草', 'emoji': '🧠'},
    'lengjing': {'label': '棱镜', 'role': '校核与拦截中枢', 'duty': '校核方案并打回修订', 'emoji': '🔍'},
    'zhongji': {'label': '中继', 'role': '路由与调度中枢', 'duty': '派单、升级与执行协调', 'emoji': '📡'},
    'wenshu': {'label': '文枢', 'role': '文档与表达模块', 'duty': '文档、汇报与输出规范', 'emoji': '📝'},
    'yuanliu': {'label': '源流', 'role': '资源与数据模块', 'duty': '资源、预算、成本与数据分析', 'emoji': '💾'},
    'weikong':   {'label': '维控', 'role': '执行与安全模块', 'duty': '运维、安全、应急与巡检', 'emoji': '🛡️'},
    'tanzhen':   {'label': '探针', 'role': '审计与校验模块', 'duty': '合规、审计、测试与质量校验', 'emoji': '⚖️'},
    'jiwu':   {'label': '机务', 'role': '工程与设施模块', 'duty': '工程实现、自动化与基础设施', 'emoji': '🔧'},
    'xulie':  {'label': '序列', 'role': '编组与权限模块', 'duty': '人员编组、权限治理与 Agent 管理', 'emoji': '🗂️'},
    'tianyan':  {'label': '天眼', 'role': '态势与情报模块', 'duty': '每日情报采集与简报', 'emoji': '🛰️'},
}

DEFAULT_ALLOW_AGENTS = {
    'main': ['xingshu'],
    'xingshu': ['lengjing', 'zhongji'],
    'lengjing': ['zhongji', 'xingshu'],
    'zhongji': ['xingshu', 'lengjing', 'yuanliu', 'wenshu', 'weikong', 'tanzhen', 'jiwu', 'xulie'],
    'wenshu': ['zhongji'],
    'yuanliu': ['zhongji'],
    'weikong': ['zhongji'],
    'tanzhen': ['zhongji'],
    'jiwu': ['zhongji'],
    'xulie': ['zhongji'],
    'tianyan': [],
}

KNOWN_MODELS = [
    {'id': 'anthropic/claude-sonnet-4-6', 'label': 'Claude Sonnet 4.6', 'provider': 'Anthropic'},
    {'id': 'anthropic/claude-opus-4-5',   'label': 'Claude Opus 4.5',   'provider': 'Anthropic'},
    {'id': 'anthropic/claude-haiku-3-5',  'label': 'Claude Haiku 3.5',  'provider': 'Anthropic'},
    {'id': 'openai/gpt-4o',               'label': 'GPT-4o',            'provider': 'OpenAI'},
    {'id': 'openai/gpt-4o-mini',          'label': 'GPT-4o Mini',       'provider': 'OpenAI'},
    {'id': 'openai-codex/gpt-5.3-codex',  'label': 'GPT-5.3 Codex',    'provider': 'OpenAI Codex'},
    {'id': 'google/gemini-2.0-flash',     'label': 'Gemini 2.0 Flash',  'provider': 'Google'},
    {'id': 'google/gemini-2.5-pro',       'label': 'Gemini 2.5 Pro',    'provider': 'Google'},
    {'id': 'copilot/claude-sonnet-4',     'label': 'Claude Sonnet 4',   'provider': 'Copilot'},
    {'id': 'copilot/claude-opus-4.5',     'label': 'Claude Opus 4.5',   'provider': 'Copilot'},
    {'id': 'github-copilot/claude-opus-4.6', 'label': 'Claude Opus 4.6', 'provider': 'GitHub Copilot'},
    {'id': 'copilot/gpt-4o',              'label': 'GPT-4o',            'provider': 'Copilot'},
    {'id': 'copilot/gemini-2.5-pro',      'label': 'Gemini 2.5 Pro',    'provider': 'Copilot'},
    {'id': 'copilot/o3-mini',             'label': 'o3-mini',           'provider': 'Copilot'},
]


def normalize_model(model_value, fallback='unknown'):
    if isinstance(model_value, str) and model_value:
        return model_value
    if isinstance(model_value, dict):
        return model_value.get('primary') or model_value.get('id') or fallback
    return fallback


def get_skills(workspace: str):
    skills_dir = pathlib.Path(workspace) / 'skills'
    skills = []
    try:
        if skills_dir.exists():
            for d in sorted(skills_dir.iterdir()):
                if d.is_dir():
                    md = d / 'SKILL.md'
                    desc = ''
                    if md.exists():
                        try:
                            for line in md.read_text(encoding='utf-8', errors='ignore').splitlines():
                                line = line.strip()
                                if line and not line.startswith('#') and not line.startswith('---'):
                                    desc = line[:100]
                                    break
                        except Exception:
                            desc = '(读取失败)'
                    skills.append({'name': d.name, 'path': str(md), 'exists': md.exists(), 'description': desc})
    except PermissionError as e:
        log.warning(f'Skills 目录访问受限: {e}')
    return skills


def _collect_openclaw_models(cfg):
    """从 openclaw.json 中收集所有已配置的 model id，与 KNOWN_MODELS 合并去重。
    解决 #127: 自定义 provider 的 model 不在下拉列表中。
    """
    known_ids = {m['id'] for m in KNOWN_MODELS}
    extra = []
    agents_cfg = cfg.get('agents', {})
    # 收集 defaults.model
    dm = normalize_model(agents_cfg.get('defaults', {}).get('model', {}), '')
    if dm and dm not in known_ids:
        extra.append({'id': dm, 'label': dm, 'provider': 'OpenClaw'})
        known_ids.add(dm)
    # 收集每个 agent 的 model
    for ag in agents_cfg.get('list', []):
        m = normalize_model(ag.get('model', ''), '')
        if m and m not in known_ids:
            extra.append({'id': m, 'label': m, 'provider': 'OpenClaw'})
            known_ids.add(m)
    # 收集 providers 中的 model id（如 copilot-proxy、anthropic 等）
    for pname, pcfg in cfg.get('providers', {}).items():
        for mid in (pcfg.get('models') or []):
            mid_str = mid if isinstance(mid, str) else (mid.get('id') or mid.get('name') or '')
            if mid_str and mid_str not in known_ids:
                extra.append({'id': mid_str, 'label': mid_str, 'provider': pname})
                known_ids.add(mid_str)
    return KNOWN_MODELS + extra


def main():
    cfg = load_openclaw_cfg()
    if not cfg:
        log.warning('cannot read openclaw.json')
        return

    agents_cfg = cfg.get('agents', {})
    default_model = normalize_model(agents_cfg.get('defaults', {}).get('model', {}), 'unknown')
    agents_list = agents_cfg.get('list', [])
    merged_models = _collect_openclaw_models(cfg)

    result = []
    seen_ids = set()
    for ag in agents_list:
        ag_id = ag.get('id', '')
        if ag_id not in ID_LABEL:
            continue
        meta = ID_LABEL[ag_id]
        workspace = str(resolve_workspace(ag_id, cfg=cfg))
        result.append({
            'id': ag_id,
            'label': meta['label'], 'role': meta['role'], 'duty': meta['duty'], 'emoji': meta['emoji'],
            'model': normalize_model(ag.get('model', default_model), default_model),
            'defaultModel': default_model,
            'workspace': workspace,
            'skills': get_skills(workspace),
            'allowAgents': ag.get('subagents', {}).get('allowAgents', DEFAULT_ALLOW_AGENTS.get(ag_id, [])),
        })
        seen_ids.add(ag_id)

    # 补充未注册但仍需在 UI 可见的舰载节点。
    for ag_id, meta in ID_LABEL.items():
        if ag_id in seen_ids or ag_id not in ID_LABEL:
            continue
        workspace = str(resolve_workspace(ag_id, cfg=cfg))
        result.append({
            'id': ag_id,
            'label': meta['label'], 'role': meta['role'], 'duty': meta['duty'], 'emoji': meta['emoji'],
            'model': default_model,
            'defaultModel': default_model,
            'workspace': workspace,
            'skills': get_skills(workspace),
            'allowAgents': DEFAULT_ALLOW_AGENTS.get(ag_id, []),
            'isDefaultModel': True,
        })

    # 保留已有的 dispatchChannel 配置 (Fix #139)
    existing_cfg = {}
    cfg_path = DATA / 'agent_config.json'
    if cfg_path.exists():
        try:
            existing_cfg = json.loads(cfg_path.read_text())
        except Exception:
            pass

    payload = {
        'generatedAt': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'defaultModel': default_model,
        'knownModels': merged_models,
        'dispatchChannel': existing_cfg.get('dispatchChannel', 'feishu'),
        'agents': result,
    }
    DATA.mkdir(exist_ok=True)
    atomic_json_write(DATA / 'agent_config.json', payload)
    log.info(f'{len(result)} agents synced')

    # 自动部署 SOUL.md 到 workspace（如果项目里有更新）
    deploy_soul_files()
    # 同步 scripts/ 到各 workspace（保持 kanban_update.py 等最新）
    sync_scripts_to_workspaces()


# 项目 agents/ 目录名 → 运行时 agent_id 映射
_SOUL_DEPLOY_MAP = {
    'main': 'main',
    'xingshu': 'xingshu',
    'lengjing': 'lengjing',
    'zhongji': 'zhongji',
    'wenshu': 'wenshu',
    'yuanliu': 'yuanliu',
    'weikong': 'weikong',
    'tanzhen': 'tanzhen',
    'jiwu': 'jiwu',
    'xulie': 'xulie',
    'tianyan': 'tianyan',
}

_SOUL_LOCAL_FILENAMES = ('SOUL.local.md', 'soul.local.md')


def _read_text(path: pathlib.Path) -> str:
    return path.read_text(encoding='utf-8', errors='ignore')


def _find_local_soul_override(ws_dir: pathlib.Path):
    for name in _SOUL_LOCAL_FILENAMES:
        candidate = ws_dir / name
        if candidate.exists():
            return candidate
    return None


def compose_soul_text(base_text: str, local_override_path: Optional[pathlib.Path]) -> str:
    base_text = base_text.rstrip()
    if not local_override_path or not local_override_path.exists():
        return base_text + '\n'

    local_text = _read_text(local_override_path)
    if not local_text.strip():
        return base_text + '\n'

    return (
        f'{base_text}\n\n'
        f'<!-- LOCAL SOUL OVERRIDE: {local_override_path.name} -->\n'
        '## 本机覆盖层（自动合成）\n\n'
        f'以下内容来自当前机器的 `{local_override_path.name}`，用于在同步仓库基线后保留本机自定义；若与前文冲突，以本节为准。\n\n'
        f'{local_text.rstrip()}\n'
    )


def _backup_before_overwrite(path: pathlib.Path):
    if not path.exists():
        return
    ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    backup = path.with_name(f'{path.name}.bak.{ts}')
    try:
        backup.write_text(_read_text(path), encoding='utf-8')
    except Exception as e:
        log.warning(f'backup failed for {path}: {e}')


def _write_text_if_changed(path: pathlib.Path, text: str) -> bool:
    try:
        current = _read_text(path)
    except FileNotFoundError:
        current = ''
    if current == text:
        return False
    if current:
        _backup_before_overwrite(path)
    path.write_text(text, encoding='utf-8')
    return True

def sync_scripts_to_workspaces():
    """将项目 scripts/ 目录同步到各 agent workspace（保持 kanban_update.py 等最新）"""
    scripts_src = BASE / 'scripts'
    if not scripts_src.is_dir():
        return
    cfg = load_openclaw_cfg()
    synced = 0
    for proj_name, runtime_id in _SOUL_DEPLOY_MAP.items():
        if runtime_id == 'main':
            continue
        ws_scripts = resolve_workspace(runtime_id, cfg=cfg) / 'scripts'
        ws_scripts.mkdir(parents=True, exist_ok=True)
        for src_file in scripts_src.iterdir():
            if src_file.suffix not in ('.py', '.sh') or src_file.stem.startswith('__'):
                continue
            dst_file = ws_scripts / src_file.name
            try:
                src_text = src_file.read_bytes()
            except Exception:
                continue
            try:
                dst_text = dst_file.read_bytes() if dst_file.exists() else b''
            except Exception:
                dst_text = b''
            if src_text != dst_text:
                dst_file.write_bytes(src_text)
                synced += 1
    if synced:
        log.info(f'{synced} script files synced to workspaces')


def deploy_soul_files():
    """将项目 agents/xxx/SOUL.md 与本机 SOUL.local.md 合成为运行态文件。"""
    agents_dir = BASE / 'agents'
    cfg = load_openclaw_cfg()
    deployed = 0
    for proj_name, runtime_id in _SOUL_DEPLOY_MAP.items():
        src = agents_dir / proj_name / 'SOUL.md'
        if not src.exists():
            continue
        ws_dir = resolve_workspace(runtime_id, cfg=cfg)
        ws_dst = ws_dir / 'SOUL.md'
        ws_compat_dst = ws_dir / 'soul.md'
        ws_dir.mkdir(parents=True, exist_ok=True)
        # 只在内容不同时更新（避免不必要的写入）
        src_text = _read_text(src).replace('__REPO_DIR__', str(BASE))
        src_text = compose_soul_text(src_text, _find_local_soul_override(ws_dir))
        wrote = False
        for dst in (ws_dst, ws_compat_dst):
            if _write_text_if_changed(dst, src_text):
                wrote = True
        if wrote:
            deployed += 1
        # 确保 sessions 目录存在
        sess_dir = pathlib.Path.home() / f'.openclaw/agents/{runtime_id}/sessions'
        sess_dir.mkdir(parents=True, exist_ok=True)
    if deployed:
        log.info(f'{deployed} SOUL.md files deployed')


if __name__ == '__main__':
    main()
