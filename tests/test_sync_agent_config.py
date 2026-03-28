"""tests for scripts/sync_agent_config.py"""
import importlib.util
import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))


def _load_sync_agent_config():
    script_path = ROOT / "scripts" / "sync_agent_config.py"
    spec = importlib.util.spec_from_file_location("sync_agent_config", script_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_sync_agent_config_accepts_allow_agents_key(tmp_path, monkeypatch):
    sync_agent_config = _load_sync_agent_config()

    cfg = {
        "agents": {
            "defaults": {"model": {"primary": "openai/gpt-4o"}},
            "list": [
                {
                    "id": "main",
                    "workspace": str(tmp_path / "workspace-main"),
                    "allowAgents": ["xingshu"],
                }
            ],
        }
    }

    data_dir = tmp_path / "data"
    monkeypatch.setattr(sync_agent_config, "DATA", data_dir)
    monkeypatch.setattr(sync_agent_config, "load_openclaw_cfg", lambda: cfg)
    monkeypatch.setattr(sync_agent_config, "deploy_soul_files", lambda: None)
    monkeypatch.setattr(sync_agent_config, "sync_scripts_to_workspaces", lambda: None)

    sync_agent_config.main()

    out = json.loads((data_dir / "agent_config.json").read_text())
    main_agent = next(agent for agent in out["agents"] if agent["id"] == "main")
    assert main_agent["allowAgents"] == ["xingshu"]


def test_deploy_soul_files_keeps_main_and_updates_non_main_without_backups(tmp_path, monkeypatch):
    sync_agent_config = _load_sync_agent_config()

    agents_dir = tmp_path / "agents"
    (agents_dir / "main").mkdir(parents=True)
    (agents_dir / "xingshu").mkdir(parents=True)
    (agents_dir / "main" / "SOUL.md").write_text("repo main\n", encoding="utf-8")
    (agents_dir / "xingshu" / "SOUL.md").write_text("repo xingshu\n", encoding="utf-8")

    main_ws = tmp_path / "workspace-main"
    xingshu_ws = tmp_path / "workspace-xingshu"
    main_ws.mkdir()
    xingshu_ws.mkdir()
    (main_ws / "SOUL.md").write_text("custom main\n", encoding="utf-8")
    (xingshu_ws / "SOUL.md").write_text("old xingshu\n", encoding="utf-8")

    cfg = {
        "agents": {
            "list": [
                {"id": "main", "workspace": str(main_ws)},
                {"id": "xingshu", "workspace": str(xingshu_ws)},
            ]
        }
    }

    monkeypatch.setattr(sync_agent_config, "BASE", tmp_path)
    monkeypatch.setattr(sync_agent_config, "load_openclaw_cfg", lambda: cfg)
    monkeypatch.setattr(sync_agent_config.pathlib.Path, "home", lambda: tmp_path)

    sync_agent_config.deploy_soul_files()

    assert (main_ws / "SOUL.md").read_text(encoding="utf-8") == "custom main\n"
    assert (xingshu_ws / "SOUL.md").read_text(encoding="utf-8") == "repo xingshu\n"
    assert not list(main_ws.glob("*.bak.*"))
    assert not list(xingshu_ws.glob("*.bak.*"))
