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
