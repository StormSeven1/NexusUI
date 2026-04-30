"""
相机跟踪 / 云台任务代理：与 NexusUI Next `/api/camera-task/*` 转发目标一致。
dev-start 仅拉起 Custombackend，故在此实现 `/api/camera-tasks/*`（及单数别名）。
"""
import secrets
from datetime import datetime
from ipaddress import ip_address
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from config import get_settings

router = APIRouter(prefix="/camera-tasks", tags=["camera-tasks"])
router_singular_alias = APIRouter(prefix="/camera-task", tags=["camera-tasks"])


class BoundingBoxIn(BaseModel):
    x: float
    y: float
    width: float
    height: float


class SingleTrackTaskRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    backend_base_url: str | None = Field(default=None, alias="backendBaseUrl")
    entity_id: str = Field(alias="entityId")
    rect_id: int | None = Field(default=None, alias="rectId")
    rect_type: int | None = Field(default=None, alias="rectType")
    track_action: int = Field(default=1, alias="trackAction")
    bounding_box: BoundingBoxIn | None = Field(default=None, alias="boundingBox")


PtzDirection = Literal["UP", "DOWN", "LEFT", "RIGHT", "ZOOM_IN", "ZOOM_OUT", "FOCUS_IN", "FOCUS_OUT"]


class PtzMoveTaskRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    backend_base_url: str | None = Field(default=None, alias="backendBaseUrl")
    entity_id: str = Field(alias="entityId")
    direction: PtzDirection


class PtzStopTaskRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    backend_base_url: str | None = Field(default=None, alias="backendBaseUrl")
    entity_id: str = Field(alias="entityId")


def _is_camera_entity_id(entity_id: str) -> bool:
    if not entity_id:
        return False
    entity_id = entity_id.strip().lower()
    if not entity_id.startswith("camera_") or len(entity_id) != len("camera_000"):
        return False
    return entity_id[7:].isdigit()


def _parse_camera_entity(entity_id: str) -> tuple[str, int]:
    raw = entity_id.strip().lower()
    if not _is_camera_entity_id(raw):
        raise HTTPException(status_code=400, detail="invalid entityId")
    suffix = raw[7:]
    idx = int(suffix, 10)
    canonical = f"camera_{idx:03d}"
    return canonical, idx


def _is_allowed_private_host(host: str) -> bool:
    if host in {"localhost"}:
        return True
    try:
        ip = ip_address(host)
        return ip.is_private or ip.is_loopback
    except ValueError:
        return False


def _gen_task_id(prefix: str) -> str:
    tick = int(datetime.now().timestamp() * 1000)
    return f"{prefix}_{tick}_{secrets.token_hex(4)}"


def _ptz_speed_for_direction(direction: str) -> dict[str, float]:
    if direction in ("ZOOM_IN", "ZOOM_OUT", "FOCUS_IN", "FOCUS_OUT"):
        return {"pan": 0.5, "tilt": 0.0}
    return {"pan": 0.5, "tilt": 0.5}


def _resolve_task_backend_base(raw_base: str | None) -> str:
    fallback = get_settings().CAMERA_TASK_BACKEND_BASE_URL
    base = (raw_base or fallback).strip()
    parsed = urlparse(base)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail="invalid backend base url")
    if not _is_allowed_private_host(parsed.hostname):
        raise HTTPException(status_code=400, detail="backend host must be private/localhost")
    return f"{parsed.scheme}://{parsed.netloc}"


async def _single_track_response(body: SingleTrackTaskRequest) -> Response:
    entity_id, _ = _parse_camera_entity(body.entity_id)

    track_action = int(body.track_action) if body.track_action is not None else 1
    if track_action not in (0, 1):
        raise HTTPException(status_code=400, detail="invalid trackAction (expected 0 cancel or 1 start)")

    if track_action == 1:
        rect_type = body.rect_type if isinstance(body.rect_type, int) else 4
    else:
        rect_type = body.rect_type if isinstance(body.rect_type, int) else 0
    rect_id = body.rect_id if isinstance(body.rect_id, int) else -1

    if track_action == 1:
        box = body.bounding_box
        if box is None or box.width <= 0 or box.height <= 0:
            raise HTTPException(status_code=400, detail="invalid boundingBox")
        if rect_id < 0:
            raise HTTPException(status_code=400, detail="invalid rectId (track id)")
    else:
        box = body.bounding_box or BoundingBoxIn(x=0.0, y=0.0, width=0.0, height=0.0)
        if rect_id < 0:
            rect_id = 0

    now = datetime.now()
    tick = now.strftime("%H%M%S") + f"{now.microsecond // 1000:03d}"
    payload = {
        "taskId": f"visual_tracking_{tick}",
        "parentTaskId": f"visual_tracking_{tick}",
        "displayName": "目标跟踪任务",
        "taskType": "MANUAL",
        "maxExecutionTimeMs": 30000,
        "version": {
            "definitionVersion": 1,
            "statusVersion": 1,
        },
        "specification": {
            "@type": "type.casia.tasks.v1.VisualTrackingTask",
            "target": {
                "action": track_action,
                "id": rect_id,
                "type": rect_type,
                "duration": -1,
                "alarm_track": -1,
                "x": round(box.x),
                "y": round(box.y),
                "w": round(box.width),
                "h": round(box.height),
            },
        },
        "createdBy": {
            "user": {
                "userId": "operator_001",
                "priority": 0,
            }
        },
        "owner": {
            "entityId": entity_id,
        },
    }

    target_base = _resolve_task_backend_base(body.backend_base_url)
    target = f"{target_base}/api/v1/publishEntity" if track_action == 0 else f"{target_base}/api/v1/tasks"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(target, json=payload)
    except Exception as e:  # noqa: BLE001
        msg = str(e).strip() or repr(e)
        raise HTTPException(
            status_code=502,
            detail=f"camera task proxy error ({type(e).__name__}) -> {target}: {msg}",
        ) from e

    content_type = resp.headers.get("content-type", "application/json; charset=utf-8")
    return Response(content=resp.text, status_code=resp.status_code, media_type=content_type)


@router.post("/single-track")
async def create_single_track_task(body: SingleTrackTaskRequest):
    return await _single_track_response(body)


@router_singular_alias.post("/single-track")
async def create_single_track_task_singular_path(body: SingleTrackTaskRequest):
    return await _single_track_response(body)


@router.post("/ptz-move")
async def create_ptz_move_task(body: PtzMoveTaskRequest):
    entity_id, _ = _parse_camera_entity(body.entity_id)
    move_task_id = _gen_task_id("ptz_move")
    parent_task_id = _gen_task_id("task_search")
    speed = _ptz_speed_for_direction(body.direction)
    payload = {
        "taskId": move_task_id,
        "parentTaskId": parent_task_id,
        "version": {"definitionVersion": 1, "statusVersion": 1},
        "displayName": f"云台控制-{body.direction}",
        "taskType": "AUTOMATIC",
        "maxExecutionTimeMs": 10000,
        "specification": {
            "@type": "type.casia.tasks.v1.PTZMoveTask",
            "direction": body.direction,
            "speed": speed,
        },
        "createdBy": {
            "system": {
                "serviceName": "camera_control_service",
                "entityId": "service_001",
                "managesOwnScheduling": True,
                "priority": 2,
            }
        },
        "owner": {"entityId": entity_id},
    }
    target_base = _resolve_task_backend_base(body.backend_base_url)
    target = f"{target_base}/api/v1/tasks"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(target, json=payload)
    except Exception as e:  # noqa: BLE001
        msg = str(e).strip() or repr(e)
        raise HTTPException(
            status_code=502,
            detail=f"camera task proxy error ({type(e).__name__}) -> {target}: {msg}",
        ) from e
    content_type = resp.headers.get("content-type", "application/json; charset=utf-8")
    return Response(content=resp.text, status_code=resp.status_code, media_type=content_type)


@router.post("/ptz-stop")
async def create_ptz_stop_task(body: PtzStopTaskRequest):
    entity_id, _ = _parse_camera_entity(body.entity_id)
    stop_task_id = _gen_task_id("ptz_stop")
    parent_task_id = _gen_task_id("task_search")
    payload = {
        "taskId": stop_task_id,
        "parentTaskId": parent_task_id,
        "version": {"definitionVersion": 1, "statusVersion": 1},
        "displayName": "停止云台控制运动",
        "taskType": "MANUAL",
        "maxExecutionTimeMs": 1000,
        "specification": {"@type": "type.casia.tasks.v1.PTZControlStop"},
        "createdBy": {
            "user": {
                "userId": "operator_001",
                "priority": 0,
            }
        },
        "owner": {"entityId": entity_id},
    }
    target_base = _resolve_task_backend_base(body.backend_base_url)
    target = f"{target_base}/api/v1/tasks"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(target, json=payload)
    except Exception as e:  # noqa: BLE001
        msg = str(e).strip() or repr(e)
        raise HTTPException(
            status_code=502,
            detail=f"camera task proxy error ({type(e).__name__}) -> {target}: {msg}",
        ) from e
    content_type = resp.headers.get("content-type", "application/json; charset=utf-8")
    return Response(content=resp.text, status_code=resp.status_code, media_type=content_type)
