"""Task notify helper utilities.

MVP 约束：
- 使用任务 `_scheduler.notify` 持久化通知元数据
- route 优先来自任务已有元数据，其次来自当前环境变量
- payload 为纯 dict，便于脚本入口与 worker 复用
"""

from __future__ import annotations

import hashlib
import json
import os
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

DEFAULT_NOTIFY_POLICY = {
    "ack": True,
    "progress": True,
    "blocked": True,
    "done": True,
}

DEFAULT_DEDUPE_WINDOWS = {
    "ack": 0,
    "progress": 120,
    "blocked": 0,
    "done": 0,
    "recovery": 0,
}

_ROUTE_ENV_ALIASES = {
    "channel": ("EDICT_NOTIFY_CHANNEL", "OPENCLAW_NOTIFY_CHANNEL", "OPENCLAW_LAST_CHANNEL"),
    "to": ("EDICT_NOTIFY_TO", "OPENCLAW_NOTIFY_TO", "OPENCLAW_LAST_TO"),
    "accountId": ("EDICT_NOTIFY_ACCOUNT_ID", "OPENCLAW_NOTIFY_ACCOUNT_ID"),
    "chatType": ("EDICT_NOTIFY_CHAT_TYPE", "OPENCLAW_NOTIFY_CHAT_TYPE"),
    "threadId": ("EDICT_NOTIFY_THREAD_ID", "OPENCLAW_NOTIFY_THREAD_ID"),
    "sourceSessionKey": (
        "EDICT_NOTIFY_SOURCE_SESSION_KEY",
        "OPENCLAW_NOTIFY_SOURCE_SESSION_KEY",
        "OPENCLAW_SESSION_KEY",
    ),
}


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _compact_dict(data: dict[str, Any] | None) -> dict[str, Any]:
    return {k: v for k, v in (data or {}).items() if v not in (None, "", [], {})}


def build_route_from_env(env: dict[str, str] | None = None) -> dict[str, Any]:
    env = env or os.environ
    route: dict[str, Any] = {}
    for field, keys in _ROUTE_ENV_ALIASES.items():
        for key in keys:
            value = (env.get(key) or "").strip()
            if value:
                route[field] = value
                break
    return _compact_dict(route)


def merge_route(existing: dict[str, Any] | None, candidate: dict[str, Any] | None) -> dict[str, Any]:
    merged = dict(existing or {})
    for key, value in _compact_dict(candidate).items():
        merged[key] = value
    return _compact_dict(merged)


def ensure_notify_scheduler(
    scheduler: dict[str, Any] | None,
    *,
    route: dict[str, Any] | None = None,
    stage: str = "",
    needs_catchup: bool | None = None,
) -> dict[str, Any]:
    data = deepcopy(scheduler or {})
    notify = deepcopy(data.get("notify") or {})
    notify["enabled"] = bool(notify.get("enabled", True))
    notify["route"] = merge_route(notify.get("route"), route or build_route_from_env())
    notify["policy"] = {**DEFAULT_NOTIFY_POLICY, **(notify.get("policy") or {})}
    notify["lastDeliveredKey"] = str(notify.get("lastDeliveredKey") or "")
    notify["lastDeliveredAt"] = str(notify.get("lastDeliveredAt") or "")
    notify["lastStage"] = str(notify.get("lastStage") or stage or "")
    notify["lastFingerprint"] = str(notify.get("lastFingerprint") or "")
    notify["pending"] = list(notify.get("pending") or [])

    recovery = deepcopy(notify.get("recovery") or {})
    recovery["needsCatchup"] = (
        bool(recovery.get("needsCatchup")) if needs_catchup is None else bool(needs_catchup)
    )
    recovery["lastRecoveryAt"] = str(recovery.get("lastRecoveryAt") or "")
    notify["recovery"] = recovery

    data["notify"] = notify
    return data


def notify_enabled(task: dict[str, Any], kind: str) -> bool:
    scheduler = ensure_notify_scheduler(task.get("_scheduler") or task.get("scheduler") or {}, stage=task.get("state", ""))
    notify = scheduler.get("notify") or {}
    policy = notify.get("policy") or {}
    if not notify.get("enabled", True):
        return False
    if kind == "ack":
        return bool(policy.get("ack", True))
    if kind == "progress":
        return bool(policy.get("progress", True))
    if kind == "blocked":
        return bool(policy.get("blocked", True))
    if kind == "done":
        return bool(policy.get("done", True))
    return True


def _stable_part(task: dict[str, Any], kind: str, message: str, *, explicit: str | None = None) -> str:
    if explicit:
        return explicit
    state = task.get("state") or ""
    raw = {
        "task_id": task.get("id") or task.get("task_id") or "",
        "kind": kind,
        "state": state,
        "message": message,
        "title": task.get("title") or "",
    }
    return hashlib.sha1(json.dumps(raw, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()[:12]


def build_notify_payload(
    task: dict[str, Any],
    *,
    kind: str,
    message: str,
    trigger: str,
    route: dict[str, Any] | None = None,
    stable_part: str | None = None,
    dedupe_window_sec: int | None = None,
) -> dict[str, Any]:
    route = merge_route(
        ((task.get("_scheduler") or task.get("scheduler") or {}).get("notify") or {}).get("route"),
        route or build_route_from_env(),
    )
    task_id = str(task.get("id") or task.get("task_id") or "")
    stable = _stable_part(task, kind, message, explicit=stable_part)
    fingerprint = hashlib.sha1(
        json.dumps(
            {
                "task_id": task_id,
                "kind": kind,
                "state": task.get("state") or "",
                "org": task.get("org") or "",
                "message": message,
            },
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    window = DEFAULT_DEDUPE_WINDOWS.get(kind, 0) if dedupe_window_sec is None else int(dedupe_window_sec)
    return {
        "task_id": task_id,
        "notify_key": f"{task_id}:{kind}:{stable}",
        "kind": kind,
        "title": task.get("title") or task_id,
        "state": task.get("state") or "",
        "org": task.get("org") or "",
        "message": message,
        "route": route,
        "dedupe": {
            "windowSec": window,
            "fingerprint": fingerprint,
        },
        "context": {
            "trigger": trigger,
            "source_session_key": route.get("sourceSessionKey", ""),
        },
        "emittedAt": utcnow_iso(),
    }
