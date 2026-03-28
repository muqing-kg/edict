#!/usr/bin/env python3
"""JSON → Postgres 数据迁移脚本。"""

import argparse
import asyncio
import json
import logging
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from app.db import async_session
from app.models.task import Task, TaskState

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
log = logging.getLogger("migrate")

STATE_MAP = {
    "Yunxiao": TaskState.Yunxiao,
    "Xingshu": TaskState.Xingshu,
    "Lengjing": TaskState.Lengjing,
    "Assigned": TaskState.Assigned,
    "Next": TaskState.Next,
    "Doing": TaskState.Doing,
    "Review": TaskState.Review,
    "Done": TaskState.Done,
    "Blocked": TaskState.Blocked,
    "Cancelled": TaskState.Cancelled,
    "Pending": TaskState.Pending,
    # 兼容旧版三省六部状态名
    "Taizi": TaskState.Yunxiao,
    "Zhongshu": TaskState.Xingshu,
    "Menxia": TaskState.Lengjing,
    "Inbox": TaskState.Yunxiao,
    "": TaskState.Yunxiao,
}


def parse_old_task(old: dict) -> dict:
    """将原始 task JSON 转换为 Edict Task 参数。"""
    state_str = old.get("state", "Yunxiao")
    state = STATE_MAP.get(state_str, TaskState.Yunxiao)

    source_task_id = old.get("id", "")
    title = old.get("title", "未命名任务")
    target_dept = old.get("targetDept") or old.get("target_dept") or ""
    assignee_org = target_dept or old.get("org") or None
    creator = old.get("official") or old.get("owner") or "system"

    updated_str = old.get("updatedAt", "")
    try:
        updated_at = datetime.fromisoformat(updated_str.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        updated_at = datetime.now(timezone.utc)

    return {
        "trace_id": str(uuid.uuid4()),
        "title": title,
        "description": old.get("now", ""),
        "priority": old.get("priority", "中"),
        "state": state,
        "assignee_org": assignee_org,
        "creator": creator,
        "tags": [source_task_id] if source_task_id else [],
        "org": old.get("org", Task.org_for_state(state, assignee_org)),
        "official": old.get("official") or old.get("owner", ""),
        "now": old.get("now", ""),
        "eta": old.get("eta", "-"),
        "block": old.get("block", "无"),
        "output": old.get("output", ""),
        "archived": bool(old.get("archived", False)),
        "flow_log": old.get("flow_log", []),
        "progress_log": old.get("progress_log", []),
        "todos": old.get("todos", []),
        "scheduler": old.get("scheduler") or {},
        "template_id": old.get("templateId", ""),
        "template_params": old.get("templateParams", {}),
        "ac": old.get("ac", ""),
        "target_dept": target_dept,
        "meta": {
            "source_task_id": source_task_id,
            "source_state": state_str,
            "source_owner": old.get("owner", ""),
            "source_official": old.get("official", ""),
            "source_output": old.get("output", ""),
            "source_ac": old.get("ac", ""),
            "source_eta": old.get("eta", ""),
            "source_block": old.get("block", ""),
        },
        "created_at": updated_at,
        "updated_at": updated_at,
    }


async def migrate(file_path: Path, dry_run: bool = False):
    """执行迁移。"""
    if not file_path.exists():
        log.error(f"数据文件不存在: {file_path}")
        return

    raw = file_path.read_text(encoding="utf-8")
    old_tasks = json.loads(raw)
    log.info(f"读取到 {len(old_tasks)} 个原始任务")

    stats = {"total": len(old_tasks), "migrated": 0, "skipped": 0, "errors": 0}
    by_state = {}
    for old in old_tasks:
        state_str = old.get("state", "?")
        by_state[state_str] = by_state.get(state_str, 0) + 1
    log.info(f"状态分布: {by_state}")

    if dry_run:
        log.info("=== DRY RUN 模式，不写入数据库 ===")
        for old in old_tasks:
            params = parse_old_task(old)
            log.info(f"  [{params['meta']['source_task_id']}] {params['title'][:40]} → {params['state'].value}")
        log.info(f"Dry run 完成: {stats['total']} 个任务待迁移")
        return

    async with async_session() as db:
        from sqlalchemy import select

        for old in old_tasks:
            try:
                params = parse_old_task(old)
                source_task_id = params["meta"]["source_task_id"]

                existing = await db.execute(select(Task).where(Task.tags.contains([source_task_id])))
                if source_task_id and existing.scalars().first():
                    log.debug(f"跳过已存在: {source_task_id}")
                    stats["skipped"] += 1
                    continue

                task = Task(**params)
                db.add(task)
                stats["migrated"] += 1
                log.info(f"✅ 迁移: [{source_task_id}] {params['title'][:40]} → {params['state'].value}")
            except Exception as e:
                log.error(f"❌ 迁移失败: {old.get('id', '?')}: {e}")
                stats["errors"] += 1

        await db.commit()

    log.info(
        f"迁移完成: 总计 {stats['total']}, 成功 {stats['migrated']}, "
        f"跳过 {stats['skipped']}, 错误 {stats['errors']}"
    )


def main():
    parser = argparse.ArgumentParser(description="Migrate JSON tasks to Postgres")
    parser.add_argument(
        "--file",
        "-f",
        default=str(Path(__file__).parent.parent.parent / "data" / "tasks_source.json"),
        help="Path to tasks_source.json",
    )
    parser.add_argument("--dry-run", action="store_true", help="Only analyze, don't write")
    args = parser.parse_args()

    asyncio.run(migrate(Path(args.file), dry_run=args.dry_run))


if __name__ == "__main__":
    main()
