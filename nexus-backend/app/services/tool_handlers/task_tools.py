"""
任务管理工具：创建任务、查询任务状态、更新任务步骤。
"""

import json
from typing import Any

from sqlalchemy import select

from app.core.db_sync import get_sync_session
from app.models.task import Task
from app.services.tool_registry import registry


@registry.handler("create_task")
def handle_create_task(args: dict[str, Any]) -> dict[str, Any]:
    task_type = args.get("task_type", "recon")
    title = args.get("title", "未命名任务")
    target_id = args.get("target_id")
    raw_steps = args.get("steps", [])

    if isinstance(raw_steps, str):
        raw_steps = [raw_steps]
    if not isinstance(raw_steps, list):
        raw_steps = []

    step_records = []
    for i, step_desc in enumerate(raw_steps):
        step_records.append({
            "index": i,
            "action": str(step_desc),
            "status": "pending",
            "result": None,
        })

    with get_sync_session() as session:
        task = Task(
            task_type=task_type,
            title=title,
            status="active",
            target_id=target_id,
            steps=json.dumps(step_records, ensure_ascii=False),
        )
        session.add(task)
        session.commit()
        task_id = task.id

    return {
        "action": "show_task",
        "success": True,
        "taskId": task_id,
        "title": title,
        "taskType": task_type,
        "status": "active",
        "targetId": target_id,
        "steps": step_records,
        "message": f"已创建任务「{title}」，共 {len(step_records)} 个步骤",
    }


@registry.handler("update_task")
def handle_update_task(args: dict[str, Any]) -> dict[str, Any]:
    task_id = args["task_id"]
    step_index = args.get("step_index")
    step_status = args.get("step_status")
    step_result = args.get("step_result")
    task_status = args.get("task_status")

    with get_sync_session() as session:
        task = session.execute(select(Task).where(Task.id == task_id)).scalar_one_or_none()
        if not task:
            return {"action": "update_task", "success": False,
                    "message": f"未找到任务 {task_id}"}

        try:
            steps = json.loads(task.steps) if task.steps else []
        except (json.JSONDecodeError, TypeError):
            steps = []

        if step_index is not None:
            try:
                step_index = int(step_index)
            except (TypeError, ValueError):
                step_index = -1
            if 0 <= step_index < len(steps):
                if step_status:
                    steps[step_index]["status"] = step_status
                if step_result is not None:
                    steps[step_index]["result"] = step_result
                task.steps = json.dumps(steps, ensure_ascii=False)

        if task_status:
            task.status = task_status

        session.commit()

        completed_steps = sum(1 for s in steps if isinstance(s, dict) and s.get("status") == "completed")
        return {
            "action": "show_task",
            "success": True,
            "taskId": task_id,
            "title": task.title,
            "taskType": task.task_type,
            "status": task.status,
            "steps": steps,
            "progress": f"{completed_steps}/{len(steps)}",
            "message": f"任务「{task.title}」已更新",
        }


@registry.handler("get_task_status")
def handle_get_task_status(args: dict[str, Any]) -> dict[str, Any]:
    task_id = args.get("task_id")

    with get_sync_session() as session:
        if task_id:
            task = session.execute(select(Task).where(Task.id == task_id)).scalar_one_or_none()
            if not task:
                return {"action": "get_task_status", "success": False,
                        "message": f"未找到任务 {task_id}"}
            tasks = [task]
        else:
            tasks = list(session.execute(
                select(Task).order_by(Task.created_at.desc()).limit(10)
            ).scalars().all())

        result = []
        for t in tasks:
            try:
                steps = json.loads(t.steps) if t.steps else []
            except (json.JSONDecodeError, TypeError):
                steps = []
            completed = sum(1 for s in steps if isinstance(s, dict) and s.get("status") == "completed")
            try:
                task_assets = json.loads(t.assigned_assets) if t.assigned_assets else []
            except (json.JSONDecodeError, TypeError):
                task_assets = []
            result.append({
                "taskId": t.id,
                "title": t.title,
                "taskType": t.task_type,
                "status": t.status,
                "targetId": t.target_id,
                "assignedAssets": task_assets,
                "steps": steps,
                "progress": f"{completed}/{len(steps)}",
                "createdAt": t.created_at.isoformat() if t.created_at else None,
            })

    return {
        "action": "get_task_status",
        "success": True,
        "tasks": result,
        "count": len(result),
        "message": f"查询到 {len(result)} 个任务",
    }
