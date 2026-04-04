#!/usr/bin/env python3
"""
同步 openclaw.json 中的 agent 配置 → data/agent_config.json
支持自动发现 agent workspace 下的 Skills 目录
"""
import datetime
import json
import logging
import os
import pathlib
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
    'weikong': {'label': '维控', 'role': '执行与安全模块', 'duty': '运维、安全、应急与巡检', 'emoji': '🛡️'},
    'tanzhen': {'label': '探针', 'role': '审计与校验模块', 'duty': '合规、审计、测试与质量校验', 'emoji': '⚖️'},
    'jiwu': {'label': '机务', 'role': '工程与设施模块', 'duty': '工程实现、自动化与基础设施', 'emoji': '🔧'},
    'xulie': {'label': '序列', 'role': '编组与权限模块', 'duty': '人员编组、权限治理与 Agent 管理', 'emoji': '🗂️'},
    'tianyan': {'label': '天眼', 'role': '态势与情报模块', 'duty': '每日情报采集与简报', 'emoji': '🛰️'},
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
    {'id': 'anthropic/claude-opus-4-5', 'label': 'Claude Opus 4.5', 'provider': 'Anthropic'},
    {'id': 'anthropic/claude-haiku-3-5', 'label': 'Claude Haiku 3.5', 'provider': 'Anthropic'},
    {'id': 'openai/gpt-4o', 'label': 'GPT-4o', 'provider': 'OpenAI'},
    {'id': 'openai/gpt-4o-mini', 'label': 'GPT-4o Mini', 'provider': 'OpenAI'},
    {'id': 'openai-codex/gpt-5.3-codex', 'label': 'GPT-5.3 Codex', 'provider': 'OpenAI Codex'},
    {'id': 'google/gemini-2.0-flash', 'label': 'Gemini 2.0 Flash', 'provider': 'Google'},
    {'id': 'google/gemini-2.5-pro', 'label': 'Gemini 2.5 Pro', 'provider': 'Google'},
    {'id': 'copilot/claude-sonnet-4', 'label': 'Claude Sonnet 4', 'provider': 'Copilot'},
    {'id': 'copilot/claude-opus-4.5', 'label': 'Claude Opus 4.5', 'provider': 'Copilot'},
    {'id': 'github-copilot/claude-opus-4.6', 'label': 'Claude Opus 4.6', 'provider': 'GitHub Copilot'},
    {'id': 'copilot/gpt-4o', 'label': 'GPT-4o', 'provider': 'Copilot'},
    {'id': 'copilot/gemini-2.5-pro', 'label': 'Gemini 2.5 Pro', 'provider': 'Copilot'},
    {'id': 'copilot/o3-mini', 'label': 'o3-mini', 'provider': 'Copilot'},
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
    """从 openclaw.json 中收集所有已配置的 model id，与 KNOWN_MODELS 合并去重。"""
    known_ids = {m['id'] for m in KNOWN_MODELS}
    extra = []
    agents_cfg = cfg.get('agents', {})
    dm = normalize_model(agents_cfg.get('defaults', {}).get('model', {}), '')
    if dm and dm not in known_ids:
        extra.append({'id': dm, 'label': dm, 'provider': 'OpenClaw'})
        known_ids.add(dm)

    # 收集 defaults.models 中显式启用的模型
    # 收集 defaults.models 中的所有模型（OpenClaw 默认启用的模型列表）
    defaults_models = agents_cfg.get('defaults', {}).get('models', {})
    if isinstance(defaults_models, dict):
        for model_id in defaults_models.keys():
            if model_id and model_id not in known_ids:
                provider = 'OpenClaw'
                if '/' in model_id:
                    provider = model_id.split('/')[0]
                extra.append({'id': model_id, 'label': model_id, 'provider': provider})
                known_ids.add(model_id)

    # 收集每个 agent 的 model
    for ag in agents_cfg.get('list', []):
        model_id = normalize_model(ag.get('model', ''), '')
        if model_id and model_id not in known_ids:
            extra.append({'id': model_id, 'label': model_id, 'provider': 'OpenClaw'})
            known_ids.add(model_id)
    for pname, pcfg in cfg.get('providers', {}).items():
        for mid in (pcfg.get('models') or []):
            model_id = mid if isinstance(mid, str) else (mid.get('id') or mid.get('name') or '')
            if model_id and model_id not in known_ids:
                extra.append({'id': model_id, 'label': model_id, 'provider': pname})
                known_ids.add(model_id)
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
        if 'allowAgents' in ag:
            allow_agents = ag.get('allowAgents', []) or []
        else:
            allow_agents = ag.get('subagents', {}).get('allowAgents', DEFAULT_ALLOW_AGENTS.get(ag_id, []))
        result.append({
            'id': ag_id,
            'label': meta['label'],
            'role': meta['role'],
            'duty': meta['duty'],
            'emoji': meta['emoji'],
            'model': normalize_model(ag.get('model', default_model), default_model),
            'defaultModel': default_model,
            'workspace': workspace,
            'skills': get_skills(workspace),
            'allowAgents': allow_agents,
        })
        seen_ids.add(ag_id)

    for ag_id, meta in ID_LABEL.items():
        if ag_id in seen_ids:
            continue
        workspace = str(resolve_workspace(ag_id, cfg=cfg))
        result.append({
            'id': ag_id,
            'label': meta['label'],
            'role': meta['role'],
            'duty': meta['duty'],
            'emoji': meta['emoji'],
            'model': default_model,
            'defaultModel': default_model,
            'workspace': workspace,
            'skills': get_skills(workspace),
            'allowAgents': DEFAULT_ALLOW_AGENTS.get(ag_id, []),
            'isDefaultModel': True,
        })

    existing_cfg = {}
    cfg_path = DATA / 'agent_config.json'
    if cfg_path.exists():
        try:
            existing_cfg = json.loads(cfg_path.read_text(encoding='utf-8'))
        except Exception:
            pass

    payload = {
        'generatedAt': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'defaultModel': default_model,
        'knownModels': merged_models,
        'dispatchChannel': existing_cfg.get('dispatchChannel') or os.getenv('DEFAULT_DISPATCH_CHANNEL', ''),
        'agents': result,
    }
    DATA.mkdir(exist_ok=True)
    atomic_json_write(DATA / 'agent_config.json', payload)
    log.info(f'{len(result)} agents synced')

    deploy_soul_files()
    sync_scripts_to_workspaces()


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

_SOUL_LOCAL_FILENAME = 'SOUL.local.md'
_MAIN_RUNTIME_ID = 'main'


def _read_text(path: pathlib.Path) -> str:
    return path.read_text(encoding='utf-8', errors='ignore')


def _find_exact_workspace_child(ws_dir: pathlib.Path, name: str) -> Optional[pathlib.Path]:
    try:
        for child in ws_dir.iterdir():
            if child.name == name:
                return child
    except FileNotFoundError:
        return None
    return None


def _find_local_soul_override(ws_dir: pathlib.Path):
    return _find_exact_workspace_child(ws_dir, _SOUL_LOCAL_FILENAME)


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


def _write_text_if_changed(path: pathlib.Path, text: str) -> bool:
    try:
        current = _read_text(path)
    except FileNotFoundError:
        current = ''
    if current == text:
        return False
    path.write_text(text, encoding='utf-8')
    return True


def _sync_script_symlink(src_file: pathlib.Path, dst_file: pathlib.Path) -> bool:
    """Create a symlink dst_file → src_file (resolved)."""
    src_resolved = src_file.resolve()
    try:
        dst_resolved = dst_file.resolve()
    except OSError:
        dst_resolved = None
    if dst_resolved == src_resolved:
        return False
    if dst_file.is_symlink() and dst_resolved == src_resolved:
        return False
    if dst_file.exists() or dst_file.is_symlink():
        dst_file.unlink()
    os.symlink(src_resolved, dst_file)
    return True


def _is_syncable_script_source(src_file: pathlib.Path, scripts_root: pathlib.Path) -> bool:
    """只同步可解析且仍位于项目 scripts/ 下的源脚本。"""
    if not src_file.is_symlink():
        return True

    try:
        src_resolved = src_file.resolve(strict=True)
    except FileNotFoundError:
        try:
            target = os.readlink(src_file)
        except OSError:
            target = '<unresolved>'
        log.warning(f'skip broken script symlink: {src_file} -> {target}')
        return False

    try:
        src_resolved.relative_to(scripts_root)
    except ValueError:
        log.warning(f'skip external script symlink: {src_file} -> {src_resolved}')
        return False
    return True


def sync_scripts_to_workspaces():
    """将项目 scripts/ 目录同步到各 agent workspace。"""
    scripts_src = BASE / 'scripts'
    if not scripts_src.is_dir():
        return
    scripts_root = scripts_src.resolve()
    cfg = load_openclaw_cfg()
    synced = 0
    for _, runtime_id in _SOUL_DEPLOY_MAP.items():
        if runtime_id == _MAIN_RUNTIME_ID:
            continue
        ws_scripts = resolve_workspace(runtime_id, cfg=cfg) / 'scripts'
        ws_scripts.mkdir(parents=True, exist_ok=True)
        for src_file in scripts_src.iterdir():
            if src_file.suffix not in ('.py', '.sh') or src_file.stem.startswith('__'):
                continue
            if not _is_syncable_script_source(src_file, scripts_root):
                continue
            dst_file = ws_scripts / src_file.name
            try:
                if _sync_script_symlink(src_file, dst_file):
                    synced += 1
            except Exception:
                continue
    if synced:
        log.info(f'{synced} script symlinks synced to workspaces')


def deploy_soul_files():
    """将非 main 节点的 SOUL 基线同步到运行态。"""
    agents_dir = BASE / 'agents'
    cfg = load_openclaw_cfg()
    deployed = 0
    for proj_name, runtime_id in _SOUL_DEPLOY_MAP.items():
        ws_dir = resolve_workspace(runtime_id, cfg=cfg)
        ws_dir.mkdir(parents=True, exist_ok=True)
        if runtime_id == _MAIN_RUNTIME_ID:
            continue
        src = agents_dir / proj_name / 'SOUL.md'
        if not src.exists():
            continue
        ws_dst = ws_dir / 'SOUL.md'
        src_text = _read_text(src).replace('__REPO_DIR__', str(BASE))
        src_text = compose_soul_text(src_text, _find_local_soul_override(ws_dir))
        if _write_text_if_changed(ws_dst, src_text):
            deployed += 1
        sess_dir = pathlib.Path.home() / f'.openclaw/agents/{runtime_id}/sessions'
        sess_dir.mkdir(parents=True, exist_ok=True)
    if deployed:
        log.info(f'{deployed} SOUL.md files deployed')


if __name__ == '__main__':
    main()
