#!/usr/bin/env python3
"""
太空舰载系统运行时卸载器。

目标：
1. 保留用户原有 main 入口目录。
2. 恢复安装前备份的 main/SOUL.md 与 main/soul.md。
3. 删除本系统注册的非 main 节点运行时目录。
4. 恢复安装前备份的 openclaw.json。
"""
import json
import pathlib
import shutil
import sys

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from utils import OPENCLAW_HOME, OPENCLAW_CFG, default_workspace  # noqa: E402


STATE_FILE = OPENCLAW_HOME / 'jianzai-install-state.json'
SOUL_FILENAMES = ('SOUL.md', 'soul.md')


def info(message: str):
    print(f'ℹ️  {message}')


def ok(message: str):
    print(f'✅ {message}')


def warn(message: str):
    print(f'⚠️  {message}')


def load_state():
    if not STATE_FILE.exists():
        raise SystemExit(f'未找到安装状态文件: {STATE_FILE}')
    return json.loads(STATE_FILE.read_text(encoding='utf-8'))


def remove_path(path: pathlib.Path):
    if not path.exists() and not path.is_symlink():
        return
    if path.is_symlink() or path.is_file():
        path.unlink()
        return
    shutil.rmtree(path)


def restore_directory(src: pathlib.Path, dst: pathlib.Path):
    remove_path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dst)


def restore_main_soul(backup_workspace: pathlib.Path, main_workspace: pathlib.Path):
    main_workspace.mkdir(parents=True, exist_ok=True)
    for filename in SOUL_FILENAMES:
        src = backup_workspace / filename
        dst = main_workspace / filename
        if src.exists():
            shutil.copy2(src, dst)
        elif dst.exists():
            dst.unlink()


def main():
    state = load_state()
    managed_agents = state.get('managedAgents') or []
    workspaces = {k: pathlib.Path(v) for k, v in (state.get('workspaces') or {}).items()}
    backup_dir = pathlib.Path(state.get('backupDir', ''))
    if not backup_dir.exists():
        raise SystemExit(f'安装前备份不存在: {backup_dir}')

    main_workspace = pathlib.Path(state.get('mainWorkspace') or default_workspace('main'))
    backup_workspaces_dir = backup_dir / 'workspaces'
    backup_agents_dir = backup_dir / 'agents'

    info('开始卸载太空舰载系统运行时...')

    for agent_id in managed_agents:
        if agent_id == 'main':
            continue
        workspace = workspaces.get(agent_id, default_workspace(agent_id))
        remove_path(workspace)
        agent_dir = OPENCLAW_HOME / 'agents' / agent_id
        remove_path(agent_dir)

    for agent_id in managed_agents:
        if agent_id == 'main':
            continue
        backup_workspace = backup_workspaces_dir / agent_id
        if backup_workspace.exists():
            restore_directory(backup_workspace, workspaces.get(agent_id, default_workspace(agent_id)))

        backup_agent_dir = backup_agents_dir / agent_id
        if backup_agent_dir.exists():
            restore_directory(backup_agent_dir, OPENCLAW_HOME / 'agents' / agent_id)

    backup_main_workspace = backup_workspaces_dir / 'main'
    if backup_main_workspace.exists():
        restore_main_soul(backup_main_workspace, main_workspace)
        ok(f'已恢复 main SOUL 文件: {main_workspace}')
    else:
        warn('安装前未发现 main workspace 备份，未恢复 main SOUL 文件')

    backup_cfg = backup_dir / 'openclaw.json'
    if backup_cfg.exists():
        OPENCLAW_HOME.mkdir(parents=True, exist_ok=True)
        shutil.copy2(backup_cfg, OPENCLAW_CFG)
        ok(f'已恢复配置: {OPENCLAW_CFG}')
    else:
        warn('安装前 openclaw.json 备份不存在，跳过配置恢复')

    if STATE_FILE.exists():
        STATE_FILE.unlink()

    ok('运行时卸载完成')
    info(f'保留的安装前备份: {backup_dir}')


if __name__ == '__main__':
    main()
