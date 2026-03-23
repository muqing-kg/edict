"""任务来源标识路由。

通过外部任务标识（例如看板里的 JJC 编号）定位 Edict 任务，
用于保持看板 CLI 与 Edict 后端之间的稳定对接。
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models.task import Task, TaskState
from ..services.event_bus import get_event_bus
from ..services.task_service import TaskService

log = logging.getLogger("edict.api.source_tasks")
router = APIRouter()


async def _find_by_source_task_id(db: AsyncSession, source_task_id: str) -> Task | None:
    """通过外部任务标识查找任务。"""
    stmt = select(Task).where(Task.tags.contains([source_task_id]))
    result = await db.execute(stmt)
    task = result.scalars().first()
    if task:
        return task

    stmt = select(Task).where(Task.meta["source_task_id"].astext == source_task_id)
    result = await db.execute(stmt)
    return result.scalars().first()


class SourceTaskTransition(BaseModel):
    new_state: str
    agent: str = "system"
    reason: str = ""


class SourceTaskProgress(BaseModel):
    agent: str
    content: str


class SourceTaskTodoUpdate(BaseModel):
    todos: list[dict]


@router.post("/by-source-id/{source_task_id}/transition")
async def transition_by_source_id(
    source_task_id: str,
    body: SourceTaskTransition,
    db: AsyncSession = Depends(get_db),
):
    task = await _find_by_source_task_id(db, source_task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task not found for source_task_id: {source_task_id}")

    bus = await get_event_bus()
    svc = TaskService(db, bus)
    try:
        new_state = TaskState(body.new_state)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid state: {body.new_state}")

    try:
        updated = await svc.transition_state(task.task_id, new_state, body.agent, body.reason)
        return {"task_id": str(updated.task_id), "state": updated.state.value}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/by-source-id/{source_task_id}/progress")
async def progress_by_source_id(
    source_task_id: str,
    body: SourceTaskProgress,
    db: AsyncSession = Depends(get_db),
):
    task = await _find_by_source_task_id(db, source_task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task not found for source_task_id: {source_task_id}")

    bus = await get_event_bus()
    svc = TaskService(db, bus)
    await svc.add_progress(task.task_id, body.agent, body.content)
    return {"message": "ok"}


@router.put("/by-source-id/{source_task_id}/todos")
async def todos_by_source_id(
    source_task_id: str,
    body: SourceTaskTodoUpdate,
    db: AsyncSession = Depends(get_db),
):
    task = await _find_by_source_task_id(db, source_task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task not found for source_task_id: {source_task_id}")

    bus = await get_event_bus()
    svc = TaskService(db, bus)
    await svc.update_todos(task.task_id, body.todos)
    return {"message": "ok"}


@router.get("/by-source-id/{source_task_id}")
async def get_by_source_id(
    source_task_id: str,
    db: AsyncSession = Depends(get_db),
):
    task = await _find_by_source_task_id(db, source_task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task not found for source_task_id: {source_task_id}")
    return task.to_dict()
