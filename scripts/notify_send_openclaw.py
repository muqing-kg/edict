#!/usr/bin/env python3
"""Bridge notify_worker command sink to `openclaw message send`.

Input: JSON on stdin
{
  "payload": {...},
  "route": {"channel": "feishu", "to": "ou_xxx", "accountId": "default", "threadId": "..."},
  "deliveredAt": "..."
}
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any

_KIND_ICON = {
    "ack": "📥",
    "progress": "📡",
    "blocked": "⛔",
    "done": "✅",
    "recovery": "♻️",
}


def render_message(payload: dict[str, Any]) -> str:
    kind = str(payload.get("kind") or "progress")
    icon = _KIND_ICON.get(kind, "📣")
    task_id = str(payload.get("task_id") or "")
    title = str(payload.get("title") or task_id or "任务通知")
    state = str(payload.get("state") or "")
    org = str(payload.get("org") or "")
    message = str(payload.get("message") or "")

    lines = [f"{icon} [{kind}] {task_id} · {title}".strip()]
    meta = []
    if state:
        meta.append(f"状态：{state}")
    if org:
        meta.append(f"节点：{org}")
    if meta:
        lines.append(" | ".join(meta))
    if message:
        lines.append(message)
    return "\n".join(lines).strip()



def build_command(route: dict[str, Any], text: str) -> list[str]:
    channel = str(route.get("channel") or "").strip()
    target = str(route.get("to") or "").strip()
    if not channel or not target:
        raise ValueError(f"notify route missing channel/to: {route}")

    cmd = [
        os.environ.get("OPENCLAW_BIN", "openclaw"),
        "message",
        "send",
        "--channel",
        channel,
        "--target",
        target,
        "--message",
        text,
    ]
    account_id = str(route.get("accountId") or "").strip()
    if account_id:
        cmd.extend(["--account", account_id])
    thread_id = str(route.get("threadId") or "").strip()
    if thread_id:
        cmd.extend(["--thread-id", thread_id])
    return cmd



def main() -> int:
    body = json.load(sys.stdin)
    payload = dict(body.get("payload") or {})
    route = dict(body.get("route") or {})
    text = render_message(payload)
    cmd = build_command(route, text)

    if os.environ.get("EDICT_NOTIFY_DRY_RUN", "").strip() in {"1", "true", "TRUE", "yes", "YES"}:
        print(json.dumps({"command": cmd, "message": text}, ensure_ascii=False))
        return 0

    proc = subprocess.run(cmd, check=False)
    return int(proc.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
