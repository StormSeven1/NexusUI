"""
系统评估 HTTP 转发（对接 system-evaluation-server gRPC）。
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse
from loguru import logger
from pydantic import BaseModel, Field

from config import get_settings
from system_eval_perf_client import fetch_system_response_time_stats
from system_eval_track_client import cancel_track_quality_eval, evaluate_track_quality
from system_eval_camera_client import (
    get_sharpness,
    get_true_north_pointing_result,
    get_visibility,
    trigger_true_north_pointing_eval,
    trigger_visibility_check,
)
from track_link_evaluator import (
    DEFAULT_DURATION_SEC,
    DEFAULT_MAX_TRACKS_PER_TYPE,
    cancel_track_link_eval,
    get_track_link_eval_result,
    start_track_link_eval,
)

router = APIRouter(prefix="/system-eval", tags=["system-eval"])


async def _grpc_to_thread(fn: Callable[..., Any], /, *args: Any, **kwargs: Any) -> Any:
    """
    同步 gRPC 客户端放到线程池执行，避免阻塞 asyncio 事件循环。
    否则评估期间航迹 WebSocket 停播，前端 prune 后地图航迹会全部消失。
    """
    return await asyncio.to_thread(fn, *args, **kwargs)


class TrackEvalRequest(BaseModel):
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    scope: str = "BOTH"
    sensor_ids: Optional[List[int]] = None
    region_type: str = ""
    bounding_box: Optional[Dict[str, float]] = None
    polygon: Optional[Dict[str, Any]] = Field(default=None, description="含 points 数组")
    fusion_unique_ids: Optional[List[int]] = None
    radar_track_ids: Optional[List[int]] = None
    ais_ids: Optional[List[int]] = None
    self_report_ids: Optional[List[int]] = None
    attr_range: Optional[Dict[str, float]] = None
    sea_fusion_filter: Optional[str] = None
    air_fusion_filter: Optional[str] = None
    display_sensor_ids: Optional[List[int]] = None


class TrackLinkEvalCancelRequest(BaseModel):
    """停止当前（或指定）航迹链路评估任务。"""
    task_id: Optional[str] = None


class TrackLinkEvalTriggerRequest(BaseModel):
    """航迹链路评估触发（Custombackend 本地旁路采样进站航迹）。"""
    duration_sec: int = Field(default=DEFAULT_DURATION_SEC, ge=5, le=300)
    max_tracks_per_type: int = Field(default=DEFAULT_MAX_TRACKS_PER_TYPE, ge=1, le=50)


class CameraSharpnessRequest(BaseModel):
    camera_entity_id: str = Field(..., min_length=1)
    return_components: bool = True


class CameraVisibilityTriggerRequest(BaseModel):
    camera_entity_id: str = Field(..., min_length=1)
    task_id: Optional[str] = None
    timeout_ms: int = Field(default=120000, ge=1000, le=600000)


class CameraPointingAccuracyTriggerRequest(BaseModel):
    camera_entity_id: str = Field(..., min_length=1)
    task_id: Optional[str] = None
    track_id: int = Field(default=0)
    unique_id: int = Field(default=0)
    longitude: float = 0.0
    latitude: float = 0.0
    azimuth: float = 0.0
    distance: float = 0.0
    range_band: str = ""
    ship_type: int = Field(default=3, ge=0)
    rect_type: int = Field(default=0, ge=0)
    timeout_ms: int = Field(default=120000, ge=1000, le=600000)


@router.get("/perf")
async def get_system_perf_stats(limit: int = Query(10, ge=1, le=100)):
    """
    系统性能评估：转发 PerformanceEvaluationService.GetSystemResponseTimeStats。
    """
    try:
        settings = get_settings()
        target = (settings.SYSTEM_EVAL_GRPC_TARGET or "").strip()
        if not target:
            return JSONResponse(
                status_code=503,
                content={
                    "code": 503,
                    "message": "未配置 SYSTEM_EVAL_GRPC_TARGET",
                    "timestamp": datetime.now().isoformat(),
                },
            )

        result = await _grpc_to_thread(fetch_system_response_time_stats, target=target, limit=limit)
        if not result.get("ok") and not result.get("stats"):
            return JSONResponse(
                status_code=502,
                content={
                    "code": 502,
                    "message": result.get("error_message") or "gRPC 调用失败",
                    "data": result,
                    "timestamp": datetime.now().isoformat(),
                },
            )

        return JSONResponse(
            status_code=200,
            content={
                "code": 200,
                "message": "ok",
                "data": {
                    "stats": result.get("stats"),
                    "error_message": result.get("error_message"),
                    "grpc_target": result.get("grpc_target"),
                },
                "timestamp": datetime.now().isoformat(),
            },
        )
    except Exception as e:
        logger.exception("system-perf HTTP 处理失败")
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"系统性能评估接口异常: {e}",
                "timestamp": datetime.now().isoformat(),
            },
        )


@router.post("/track-link/trigger")
async def post_track_link_eval_trigger(body: Optional[TrackLinkEvalTriggerRequest] = Body(None)):
    """
    触发航迹链路评估：Custombackend 本地旁路采样进站航迹（gRPC/融合等 queue_track_data 路径）。
    不依赖 system-evaluation-server DDS。
    """
    try:
        req = body or TrackLinkEvalTriggerRequest()
        result = start_track_link_eval(
            duration_sec=req.duration_sec,
            max_tracks_per_type=req.max_tracks_per_type,
        )
        if result.get("conflict"):
            return JSONResponse(
                status_code=409,
                content={
                    "code": 409,
                    "message": result.get("message") or "已有评估在进行中",
                    "data": result,
                    "timestamp": datetime.now().isoformat(),
                },
            )
        if not result.get("ok"):
            return JSONResponse(
                status_code=502,
                content={
                    "code": 502,
                    "message": result.get("message") or "触发失败",
                    "data": result,
                    "timestamp": datetime.now().isoformat(),
                },
            )
        return JSONResponse(
            status_code=200,
            content={
                "code": 200,
                "message": "ok",
                "data": {
                    "task_id": result.get("task_id"),
                    "status": result.get("status"),
                    "duration_sec": result.get("duration_sec"),
                    "max_tracks_per_type": result.get("max_tracks_per_type"),
                    "source": "custombackend_ingress",
                },
                "timestamp": datetime.now().isoformat(),
            },
        )
    except Exception as e:
        logger.exception("track-link trigger 失败")
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"航迹链路评估触发异常: {e}",
                "timestamp": datetime.now().isoformat(),
            },
        )


@router.get("/track-link/result")
async def get_track_link_eval_result_api(task_id: Optional[str] = Query(None)):
    """
    查询航迹链路评估进度/结果（Custombackend 本地采集）。
    collecting → 返回 elapsed/remaining；done → 返回 results。
    """
    try:
        result = get_track_link_eval_result(task_id=task_id)
        if result.get("not_found"):
            return JSONResponse(
                status_code=404,
                content={
                    "code": 404,
                    "message": result.get("message") or "未找到评估任务",
                    "timestamp": datetime.now().isoformat(),
                },
            )
        if not result.get("ok"):
            return JSONResponse(
                status_code=502,
                content={
                    "code": 502,
                    "message": result.get("message") or "查询失败",
                    "data": result,
                    "timestamp": datetime.now().isoformat(),
                },
            )
        return JSONResponse(
            status_code=200,
            content={
                "code": 200,
                "message": "ok",
                "data": {
                    "task_id": result.get("task_id"),
                    "status": result.get("status"),
                    "duration_sec": result.get("duration_sec"),
                    "elapsed_sec": result.get("elapsed_sec"),
                    "remaining_sec": result.get("remaining_sec"),
                    "type_counts": result.get("type_counts"),
                    "results": result.get("results"),
                    "has_data": result.get("has_data"),
                    "message": result.get("message"),
                    "error": result.get("error"),
                    "started_at": result.get("started_at"),
                    "ended_at": result.get("ended_at"),
                    "source": "custombackend_ingress",
                },
                "timestamp": datetime.now().isoformat(),
            },
        )
    except Exception as e:
        logger.exception("track-link result 查询失败")
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"航迹链路评估查询异常: {e}",
                "timestamp": datetime.now().isoformat(),
            },
        )


@router.post("/track-link/cancel")
async def post_track_link_eval_cancel(body: Optional[TrackLinkEvalCancelRequest] = Body(None)):
    """停止当前（或指定 task_id）航迹链路评估（Custombackend 本地）。"""
    try:
        req = body or TrackLinkEvalCancelRequest()
        result = cancel_track_link_eval(task_id=req.task_id)
        if not result.get("ok"):
            return JSONResponse(
                status_code=502,
                content={
                    "code": 502,
                    "message": result.get("message") or "停止失败",
                    "data": result,
                    "timestamp": datetime.now().isoformat(),
                },
            )
        return JSONResponse(
            status_code=200,
            content={
                "code": 200,
                "message": "ok",
                "data": {
                    "cancelled": result.get("cancelled"),
                    "task_id": result.get("task_id"),
                    "status": result.get("status"),
                    "message": result.get("message"),
                    "source": "custombackend_ingress",
                },
                "timestamp": datetime.now().isoformat(),
            },
        )
    except Exception as e:
        logger.exception("track-link cancel 失败")
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"停止航迹链路评估异常: {e}",
                "timestamp": datetime.now().isoformat(),
            },
        )

@router.post("/track/cancel")
async def post_track_quality_cancel():
    """停止当前进行中的航迹质量评估（system-evaluation-server）。"""
    try:
        target, err_resp = _system_eval_target_or_503()
        if err_resp:
            return err_resp
        result = await _grpc_to_thread(cancel_track_quality_eval, target)
        if not result.get("ok"):
            return JSONResponse(
                status_code=502,
                content={
                    "code": 502,
                    "message": result.get("error_message") or "停止失败",
                    "data": result,
                    "timestamp": datetime.now().isoformat(),
                },
            )
        return JSONResponse(
            status_code=200,
            content={
                "code": 200,
                "message": "ok",
                "data": {
                    "cancelled_count": result.get("cancelled_count"),
                    "message": result.get("message"),
                    "grpc_target": result.get("grpc_target"),
                },
                "timestamp": datetime.now().isoformat(),
            },
        )
    except Exception as e:
        logger.exception("track cancel 失败")
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"停止航迹质量评估异常: {e}",
                "timestamp": datetime.now().isoformat(),
            },
        )


@router.post("/tasks/stop-all")
async def post_stop_all_eval_tasks():
    """
    停止全部可取消评估任务：
    - 航迹链路采集（Custombackend 本地）
    - 航迹质量评估（system-evaluation-server gRPC，若已配置）
    """
    try:
        link = cancel_track_link_eval()
        parts = []
        if link.get("cancelled"):
            parts.append(f"链路任务 {link.get('task_id') or ''} 已停止".strip())
        else:
            parts.append(link.get("message") or "链路：无进行中任务")

        quality: Dict[str, Any] = {
            "ok": True,
            "cancelled_count": 0,
            "message": "未配置 SYSTEM_EVAL_GRPC_TARGET，跳过质量评估停止",
        }
        target = (get_settings().SYSTEM_EVAL_GRPC_TARGET or "").strip()
        if target:
            quality = await _grpc_to_thread(cancel_track_quality_eval, target)
            if quality.get("ok"):
                n = int(quality.get("cancelled_count") or 0)
                parts.append(
                    quality.get("message")
                    or (f"质量评估：已请求停止 {n} 个" if n else "质量评估：无进行中任务")
                )
            else:
                parts.append(f"质量评估停止失败: {quality.get('error_message') or 'unknown'}")
        else:
            parts.append(quality["message"])

        ok = bool(link.get("ok")) and bool(quality.get("ok"))
        return JSONResponse(
            status_code=200 if ok else 502,
            content={
                "code": 200 if ok else 502,
                "message": "；".join(parts),
                "data": {
                    "track_link": link,
                    "track_quality": quality,
                    "grpc_target": target or None,
                },
                "timestamp": datetime.now().isoformat(),
            },
        )
    except Exception as e:
        logger.exception("stop-all eval tasks 失败")
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"停止全部评估任务异常: {e}",
                "timestamp": datetime.now().isoformat(),
            },
        )
@router.post("/track/evaluate")
async def post_track_evaluate(body: TrackEvalRequest = Body(...)):
    """
    航迹质量评估：转发 TrackEvaluationService.EvaluateTrackQuality。
    """
    try:
        settings = get_settings()
        target = (settings.SYSTEM_EVAL_GRPC_TARGET or "").strip()
        if not target:
            return JSONResponse(
                status_code=503,
                content={
                    "code": 503,
                    "message": "未配置 SYSTEM_EVAL_GRPC_TARGET",
                    "timestamp": datetime.now().isoformat(),
                },
            )

        polygon_points = None
        if body.region_type == "polygon" and body.polygon:
            polygon_points = body.polygon.get("points") or []

        result = await _grpc_to_thread(
            evaluate_track_quality,
            target=target,
            start_time=body.start_time,
            end_time=body.end_time,
            scope=body.scope,
            sensor_ids=body.sensor_ids,
            region_type=body.region_type,
            bounding_box=body.bounding_box,
            polygon_points=polygon_points,
            fusion_unique_ids=body.fusion_unique_ids,
            radar_track_ids=body.radar_track_ids,
            ais_ids=body.ais_ids,
            self_report_ids=body.self_report_ids,
            attr_range=body.attr_range,
            sea_fusion_filter=body.sea_fusion_filter,
            air_fusion_filter=body.air_fusion_filter,
            display_sensor_ids=body.display_sensor_ids,
            timeout_sec=300.0,
        )
        if result.get("resource_exhausted"):
            return JSONResponse(
                status_code=503,
                content={
                    "code": 503,
                    "message": result.get("error_message") or "航迹评估服务繁忙",
                    "data": result,
                    "timestamp": datetime.now().isoformat(),
                },
            )
        if not result.get("ok") and not result.get("result"):
            return JSONResponse(
                status_code=502,
                content={
                    "code": 502,
                    "message": result.get("error_message") or "gRPC 调用失败",
                    "data": result,
                    "timestamp": datetime.now().isoformat(),
                },
            )

        return JSONResponse(
            status_code=200,
            content={
                "code": 200,
                "message": "ok",
                "data": {
                    "result": result.get("result"),
                    "error_message": result.get("error_message"),
                    "grpc_target": result.get("grpc_target"),
                },
                "timestamp": datetime.now().isoformat(),
            },
        )
    except Exception as e:
        logger.exception("track-eval HTTP 处理失败")
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"航迹评估接口异常: {e}",
                "timestamp": datetime.now().isoformat(),
            },
        )


def _system_eval_target_or_503():
    settings = get_settings()
    target = (settings.SYSTEM_EVAL_GRPC_TARGET or "").strip()
    if not target:
        return None, JSONResponse(
            status_code=503,
            content={
                "code": 503,
                "message": "未配置 SYSTEM_EVAL_GRPC_TARGET",
                "timestamp": datetime.now().isoformat(),
            },
        )
    return target, None


@router.post("/camera/sharpness")
async def post_camera_sharpness(body: CameraSharpnessRequest = Body(...)):
    """相机清晰度：转发 CameraEvaluationService.GetSharpness。"""
    try:
        target, err_resp = _system_eval_target_or_503()
        if err_resp:
            return err_resp

        result = await _grpc_to_thread(
            get_sharpness,
            target=target,
            camera_entity_id=body.camera_entity_id,
            return_components=body.return_components,
        )
        if not result.get("ok") and not result.get("sharpness"):
            return JSONResponse(
                status_code=502,
                content={
                    "code": 502,
                    "message": result.get("error_message") or "gRPC 调用失败",
                    "data": result,
                    "timestamp": datetime.now().isoformat(),
                },
            )
        return JSONResponse(
            status_code=200,
            content={
                "code": 200,
                "message": "ok",
                "data": {
                    "sharpness": result.get("sharpness"),
                    "error_message": result.get("error_message"),
                    "grpc_target": result.get("grpc_target"),
                },
                "timestamp": datetime.now().isoformat(),
            },
        )
    except Exception as e:
        logger.exception("camera sharpness HTTP 处理失败")
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"相机清晰度接口异常: {e}",
                "timestamp": datetime.now().isoformat(),
            },
        )


@router.post("/camera/visibility/trigger")
async def post_camera_visibility_trigger(body: CameraVisibilityTriggerRequest = Body(...)):
    """相机能见度评估：转发 TriggerVisibilityCheck（异步触发）。"""
    target, err_resp = _system_eval_target_or_503()
    if err_resp:
        return err_resp

    result = await _grpc_to_thread(
        trigger_visibility_check,
        target=target,
        camera_entity_id=body.camera_entity_id,
        task_id=body.task_id,
        timeout_ms=body.timeout_ms,
    )
    if not result.get("ok") and not result.get("trigger"):
        return JSONResponse(
            status_code=502,
            content={
                "code": 502,
                "message": result.get("error_message") or "gRPC 调用失败",
                "data": result,
                "timestamp": datetime.now().isoformat(),
            },
        )
    return JSONResponse(
        status_code=200,
        content={
            "code": 200,
            "message": "ok",
            "data": {
                "trigger": result.get("trigger"),
                "error_message": result.get("error_message"),
                "grpc_target": result.get("grpc_target"),
            },
            "timestamp": datetime.now().isoformat(),
        },
    )


@router.get("/camera/visibility")
async def get_camera_visibility(camera_entity_id: str = Query(..., min_length=1)):
    """查询相机最近一次能见度结果：转发 GetVisibility。"""
    target, err_resp = _system_eval_target_or_503()
    if err_resp:
        return err_resp

    result = await _grpc_to_thread(get_visibility, target=target, camera_entity_id=camera_entity_id)
    if not result.get("ok") and not result.get("visibility"):
        return JSONResponse(
            status_code=502,
            content={
                "code": 502,
                "message": result.get("error_message") or "gRPC 调用失败",
                "data": result,
                "timestamp": datetime.now().isoformat(),
            },
        )
    return JSONResponse(
        status_code=200,
        content={
            "code": 200,
            "message": "ok",
            "data": {
                "visibility": result.get("visibility"),
                "error_message": result.get("error_message"),
                "grpc_target": result.get("grpc_target"),
            },
            "timestamp": datetime.now().isoformat(),
        },
    )


@router.post("/camera/pointing-accuracy/trigger")
async def post_camera_pointing_accuracy_trigger(body: CameraPointingAccuracyTriggerRequest = Body(...)):
    """相机指向准确度评估：转发 TriggerTrueNorthPointingEval（异步触发）。"""
    target, err_resp = _system_eval_target_or_503()
    if err_resp:
        return err_resp

    result = await _grpc_to_thread(
        trigger_true_north_pointing_eval,
        target=target,
        camera_entity_id=body.camera_entity_id,
        task_id=body.task_id,
        track_id=body.track_id,
        unique_id=body.unique_id,
        longitude=body.longitude,
        latitude=body.latitude,
        azimuth=body.azimuth,
        distance=body.distance,
        range_band=body.range_band,
        ship_type=body.ship_type,
        rect_type=body.rect_type,
        timeout_ms=body.timeout_ms,
    )
    if not result.get("ok") and not result.get("trigger"):
        return JSONResponse(
            status_code=502,
            content={
                "code": 502,
                "message": result.get("error_message") or "gRPC 调用失败",
                "data": result,
                "timestamp": datetime.now().isoformat(),
            },
        )
    return JSONResponse(
        status_code=200,
        content={
            "code": 200,
            "message": "ok",
            "data": {
                "trigger": result.get("trigger"),
                "error_message": result.get("error_message"),
                "grpc_target": result.get("grpc_target"),
            },
            "timestamp": datetime.now().isoformat(),
        },
    )


@router.get("/camera/pointing-accuracy")
async def get_camera_pointing_accuracy(
    camera_entity_id: str = Query(..., min_length=1),
    task_id: Optional[str] = Query(None),
    lookback_hours: int = Query(72, ge=0, le=24 * 365),
):
    """查询相机指向准确度结果：转发 GetTrueNorthPointingResult。默认近 3 天。"""
    target, err_resp = _system_eval_target_or_503()
    if err_resp:
        return err_resp

    result = await _grpc_to_thread(
        get_true_north_pointing_result,
        target=target,
        camera_entity_id=camera_entity_id,
        task_id=task_id,
        lookback_hours=lookback_hours,
    )
    if not result.get("ok") and not result.get("result"):
        return JSONResponse(
            status_code=502,
            content={
                "code": 502,
                "message": result.get("error_message") or "gRPC 调用失败",
                "data": result,
                "timestamp": datetime.now().isoformat(),
            },
        )
    return JSONResponse(
        status_code=200,
        content={
            "code": 200,
            "message": "ok",
            "data": {
                "result": result.get("result"),
                "error_message": result.get("error_message"),
                "grpc_target": result.get("grpc_target"),
            },
            "timestamp": datetime.now().isoformat(),
        },
    )
