#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "开始卸载太空舰载系统运行时..."
python3 "$REPO_DIR/scripts/uninstall_openclaw_runtime.py"

if command -v openclaw >/dev/null 2>&1; then
  if openclaw gateway restart >/dev/null 2>&1; then
    echo "✅ Gateway 已重启"
  else
    echo "⚠️  Gateway 重启失败，请手动执行: openclaw gateway restart"
  fi
fi
