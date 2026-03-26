"""Notify Worker — 消费 task.notify 事件并执行可靠发送。

MVP 范围：
- Redis Streams consume / ACK / reclaim stale
- 基于 `_scheduler.notify` 的最小 route 持久化与回填
- notify_key + fingerprint 去重
- 启动 reconcile：对 needsCatchup / stage 漂移任务补发 recovery
- 发送端默认写入 JSONL outbox，可通过命令适配外部通道
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shlex
import signal
import socket
import subprocess
import sys
from pathlib import Path
from typing import Any

from ..services.event_bus import EventBus, TOPIC_TASK_NOTIFY
from ..services.notify_support import (
    build_notify_payload,
    build_route_from_env,
    ensure_notify_scheduler,
    merge_route,
    utcnow_iso,
)

log = logging.getLogger("edict.notifier")

GROUP = "notifier"
CONSUMER = f"notify-{socket.gethostname() or '1'}"


def _detect_repo_root(start: Path | None = None) -> Path:
    current = (start or Path(__file__).resolve()).resolve()
    candidates = [current.parent, *current.parents]
    for parent in candidates:
        if (parent / "scripts").exists() and (parent / "data").exists():
            return parent
    # container layout fallback: /app/app/workers/notify_worker.py -> /app
    if len(current.parents) > 2 and current.parents[1].name == "app" and current.parents[2].name == "app":
        return current.parents[2]
    # host repo layout fallback: .../edict/backend/app/workers/notify_worker.py -> repo root at parents[4]
    if len(current.parents) > 4:
        return current.parents[4]
    return current.parents[len(current.parents) - 1]


REPO_ROOT = _detect_repo_root()
DEFAULT_TASKS_FILE = REPO_ROOT / "data" / "tasks_source.json"
DEFAULT_OUTBOX = Path(os.environ.get("EDICT_NOTIFY_OUTBOX", "/tmp/edict_notify_outbox.jsonl"))

SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from file_lock import atomic_json_read, atomic_json_update  # noqa: E402


class JsonTaskNotifyStore:
    def __init__(self, tasks_file: str | os.PathLike[str] | None = None):
        self.tasks_file = Path(tasks_file or os.environ.get("EDICT_TASKS_FILE") or DEFAULT_TASKS_FILE)

    def _load(self) -> list[dict[str, Any]]:
        return atomic_json_read(self.tasks_file, []) or []

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        for task in self._load():
            if str(task.get("id")) == str(task_id):
                return task
        return None

    def list_tasks(self) -> list[dict[str, Any]]:
        return self._load()

    def ensure_notify(self, task_id: str, route: dict[str, Any] | None = None) -> dict[str, Any]:
        holder: dict[str, Any] = {}

        def modifier(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
            for task in tasks:
                if str(task.get("id")) != str(task_id):
                    continue
                task["_scheduler"] = ensure_notify_scheduler(
                    task.get("_scheduler"),
                    route=route,
                    stage=str(task.get("state") or ""),
                )
                holder["task"] = dict(task)
                return tasks
            raise KeyError(task_id)

        atomic_json_update(self.tasks_file, modifier, [])
        return holder["task"]

    def mark_pending(
        self,
        task_id: str,
        notify_key: str,
        *,
        route: dict[str, Any] | None = None,
        needs_catchup: bool = True,
    ) -> dict[str, Any]:
        holder: dict[str, Any] = {}

        def modifier(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
            for task in tasks:
                if str(task.get("id")) != str(task_id):
                    continue
                scheduler = ensure_notify_scheduler(
                    task.get("_scheduler"),
                    route=route,
                    stage=str(task.get("state") or ""),
                    needs_catchup=needs_catchup,
                )
                notify = scheduler["notify"]
                pending = list(notify.get("pending") or [])
                if notify_key and notify_key not in pending:
                    pending.append(notify_key)
                notify["pending"] = pending[-20:]
                task["_scheduler"] = scheduler
                holder["task"] = dict(task)
                return tasks
            raise KeyError(task_id)

        atomic_json_update(self.tasks_file, modifier, [])
        return holder["task"]

    def mark_delivered(
        self,
        task_id: str,
        *,
        notify_key: str,
        fingerprint: str,
        kind: str,
        delivered_at: str,
        route: dict[str, Any] | None = None,
        recovery_at: str | None = None,
    ) -> dict[str, Any]:
        holder: dict[str, Any] = {}

        def modifier(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
            for task in tasks:
                if str(task.get("id")) != str(task_id):
                    continue
                scheduler = ensure_notify_scheduler(
                    task.get("_scheduler"),
                    route=route,
                    stage=str(task.get("state") or ""),
                    needs_catchup=False,
                )
                notify = scheduler["notify"]
                notify["lastDeliveredKey"] = notify_key
                notify["lastDeliveredAt"] = delivered_at
                notify["lastFingerprint"] = fingerprint
                notify["lastStage"] = str(task.get("state") or notify.get("lastStage") or "")
                notify["pending"] = [item for item in list(notify.get("pending") or []) if item != notify_key]
                if kind == "recovery":
                    notify["recovery"]["lastRecoveryAt"] = recovery_at or delivered_at
                notify["recovery"]["needsCatchup"] = False
                task["_scheduler"] = scheduler
                holder["task"] = dict(task)
                return tasks
            raise KeyError(task_id)

        atomic_json_update(self.tasks_file, modifier, [])
        return holder["task"]

    def mark_needs_catchup(
        self,
        task_id: str,
        *,
        route: dict[str, Any] | None = None,
    ) -> None:
        def modifier(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
            for task in tasks:
                if str(task.get("id")) != str(task_id):
                    continue
                task["_scheduler"] = ensure_notify_scheduler(
                    task.get("_scheduler"),
                    route=route,
                    stage=str(task.get("state") or ""),
                    needs_catchup=True,
                )
                return tasks
            raise KeyError(task_id)

        atomic_json_update(self.tasks_file, modifier, [])


class NotifyWorker:
    def __init__(
        self,
        *,
        bus: EventBus | None = None,
        store: JsonTaskNotifyStore | None = None,
        outbox_path: str | os.PathLike[str] | None = None,
        min_idle_ms: int = 60000,
    ):
        self.bus = bus or EventBus()
        self.store = store or JsonTaskNotifyStore()
        self.outbox_path = Path(outbox_path or os.environ.get("EDICT_NOTIFY_OUTBOX") or DEFAULT_OUTBOX)
        self.min_idle_ms = min_idle_ms
        self._running = False

    async def start(self):
        await self.bus.connect()
        await self.bus.ensure_consumer_group(TOPIC_TASK_NOTIFY, GROUP)
        self._running = True
        log.info("📮 Notify worker started")
        await self._startup_reconcile()
        await self._recover_pending()

        while self._running:
            try:
                await self._poll_cycle()
            except Exception as exc:
                log.error("Notify poll error: %s", exc, exc_info=True)
                await asyncio.sleep(2)

    async def stop(self):
        self._running = False
        await self.bus.close()
        log.info("Notify worker stopped")

    async def _startup_reconcile(self):
        for task in self.store.list_tasks():
            scheduler = ensure_notify_scheduler(task.get("_scheduler"), stage=str(task.get("state") or ""))
            notify = scheduler.get("notify") or {}
            route = merge_route(notify.get("route"), build_route_from_env())
            if route != (notify.get("route") or {}):
                self.store.ensure_notify(str(task.get("id") or ""), route=route)
                notify["route"] = route

            needs_catchup = bool((notify.get("recovery") or {}).get("needsCatchup"))
            stage_changed = bool(notify.get("lastStage")) and str(task.get("state") or "") != str(notify.get("lastStage") or "")
            if not notify.get("enabled", True):
                continue
            if not route:
                continue
            if not needs_catchup and not stage_changed:
                continue

            message = f"系统已恢复，当前任务状态：{task.get('state') or '-'}；{task.get('now') or task.get('title') or ''}".strip("；")
            payload = build_notify_payload(
                task,
                kind="recovery",
                message=message,
                trigger="startup.recovery",
                route=route,
                stable_part=str(task.get("state") or "recovery"),
                dedupe_window_sec=0,
            )
            self.store.mark_pending(str(task.get("id") or ""), payload["notify_key"], route=route, needs_catchup=True)
            await self.bus.publish(
                topic=TOPIC_TASK_NOTIFY,
                trace_id=str(task.get("id") or payload["notify_key"]),
                event_type="task.notify.recovery",
                producer="notify_worker.startup",
                payload=payload,
                meta={"startup_reconcile": True},
            )

    async def _recover_pending(self):
        events = await self.bus.claim_stale(
            TOPIC_TASK_NOTIFY,
            GROUP,
            CONSUMER,
            min_idle_ms=self.min_idle_ms,
            count=20,
        )
        for entry_id, event in events:
            await self._process_and_ack(entry_id, event)

    async def _poll_cycle(self):
        events = await self.bus.consume(
            TOPIC_TASK_NOTIFY,
            GROUP,
            CONSUMER,
            count=5,
            block_ms=2000,
        )
        for entry_id, event in events:
            await self._process_and_ack(entry_id, event)

    async def _process_and_ack(self, entry_id: str, event: dict[str, Any]):
        await self._handle_notify(entry_id, event)
        await self.bus.ack(TOPIC_TASK_NOTIFY, GROUP, entry_id)

    async def _handle_notify(self, entry_id: str, event: dict[str, Any]):
        payload = dict(event.get("payload") or {})
        task_id = str(payload.get("task_id") or "")
        notify_key = str(payload.get("notify_key") or entry_id)
        kind = str(payload.get("kind") or "progress")
        dedupe = dict(payload.get("dedupe") or {})
        fingerprint = str(dedupe.get("fingerprint") or "")
        route = merge_route(payload.get("route"), build_route_from_env())

        task = self.store.get_task(task_id)
        if task is None:
            log.warning("Skip notify %s: task %s not found", notify_key, task_id)
            return

        task = self.store.ensure_notify(task_id, route=route)
        notify = ((task.get("_scheduler") or {}).get("notify") or {})
        route = merge_route(notify.get("route"), route)
        if route != (notify.get("route") or {}):
            task = self.store.ensure_notify(task_id, route=route)
            notify = ((task.get("_scheduler") or {}).get("notify") or {})

        if notify.get("lastDeliveredKey") == notify_key:
            log.info("Dedup by key: %s", notify_key)
            return
        if fingerprint and notify.get("lastFingerprint") == fingerprint:
            log.info("Dedup by fingerprint: %s", notify_key)
            self.store.mark_delivered(
                task_id,
                notify_key=notify_key,
                fingerprint=fingerprint,
                kind=kind,
                delivered_at=notify.get("lastDeliveredAt") or utcnow_iso(),
                route=route,
            )
            return
        if not route:
            log.warning("Notify route missing for %s, mark catchup", task_id)
            self.store.mark_needs_catchup(task_id, route=route)
            return

        delivered_at = utcnow_iso()
        await self._send_message(payload, route=route, delivered_at=delivered_at)
        self.store.mark_delivered(
            task_id,
            notify_key=notify_key,
            fingerprint=fingerprint,
            kind=kind,
            delivered_at=delivered_at,
            route=route,
            recovery_at=delivered_at if kind == "recovery" else None,
        )
        log.info("✅ delivered notify %s kind=%s task=%s", notify_key, kind, task_id)

    async def _send_message(self, payload: dict[str, Any], *, route: dict[str, Any], delivered_at: str):
        sink = (os.environ.get("EDICT_NOTIFY_SINK") or "file").strip().lower()
        if sink == "command":
            await self._send_via_command(payload, route=route, delivered_at=delivered_at)
            return
        await self._append_outbox(
            {
                "deliveredAt": delivered_at,
                "task_id": payload.get("task_id"),
                "notify_key": payload.get("notify_key"),
                "kind": payload.get("kind"),
                "message": payload.get("message"),
                "route": route,
                "title": payload.get("title"),
                "state": payload.get("state"),
                "org": payload.get("org"),
            }
        )

    async def _append_outbox(self, row: dict[str, Any]):
        self.outbox_path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(row, ensure_ascii=False)

        def _write():
            with self.outbox_path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _write)

    async def _send_via_command(self, payload: dict[str, Any], *, route: dict[str, Any], delivered_at: str):
        raw = (os.environ.get("EDICT_NOTIFY_COMMAND") or "").strip()
        if not raw:
            raise RuntimeError("EDICT_NOTIFY_COMMAND is required when EDICT_NOTIFY_SINK=command")
        cmd = shlex.split(raw)
        body = json.dumps({"payload": payload, "route": route, "deliveredAt": delivered_at}, ensure_ascii=False)

        def _run():
            proc = subprocess.run(cmd, input=body, text=True, capture_output=True, check=False)
            if proc.returncode != 0:
                raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"notify command rc={proc.returncode}")

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _run)


async def run_notifier():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    worker = NotifyWorker()
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(worker.stop()))
    await worker.start()


if __name__ == "__main__":
    asyncio.run(run_notifier())
