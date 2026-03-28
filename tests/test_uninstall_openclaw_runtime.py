"""tests for scripts/uninstall_openclaw_runtime.py"""
import importlib.util
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))


def _load_uninstall_runtime():
    script_path = ROOT / "scripts" / "uninstall_openclaw_runtime.py"
    spec = importlib.util.spec_from_file_location("uninstall_openclaw_runtime", script_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_restore_main_soul_restores_uppercase_from_backup(tmp_path):
    uninstall_runtime = _load_uninstall_runtime()

    backup_workspace = tmp_path / "backup-main"
    main_workspace = tmp_path / "workspace-main"
    backup_workspace.mkdir()
    main_workspace.mkdir()

    (backup_workspace / "SOUL.md").write_text("backup main\n", encoding="utf-8")
    (main_workspace / "SOUL.md").write_text("runtime main\n", encoding="utf-8")

    uninstall_runtime.restore_main_soul(backup_workspace, main_workspace)

    assert (main_workspace / "SOUL.md").read_text(encoding="utf-8") == "backup main\n"
