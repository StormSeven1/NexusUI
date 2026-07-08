"""
系统评估 HTTP 转发（对接 system-evaluation-server gRPC）。
"""
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse
from loguru import logger
from pydantic import BaseModel, Field

from config import get_settings
from system_eval_perf_client import fetch_system_response_time_stats
from system_eval_track_client import evaluate_track_quality
from system_eval_camera_client import (
    get_sharpness,
    get_true_north_pointing_result,
    get_visibility,
    trigger_true_north_pointing_eval,
    trigger_visibility_check,
)

router = APIRouter(prefix="/system-eval", tags=["system-eval"])


class TrackEvalRequest(BaseModel):
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    scope: str = "BOTH"
    sensor_ids: Optional[List[int]] = None
    region_type: str = ""
    bounding_box: Optional[Dict[str, float]] = None
    polygon: Optional[Dict[str, Any]] = Field(default=None, description="含 points 数组")
    fused_track_id: Optional[int] = None
    unique_id: Optional[int] = None
    attr_range: Optional[Dict[str, float]] = None
    sea_fusion_filter: Optional[str] = None
    air_fusion_filter: Optional[str] = None
    display_sensor_ids: Optional[List[int]] = None


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

        result = fetch_system_response_time_stats(target=target, limit=limit)
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

        result = evaluate_track_quality(
            target=target,
            start_time=body.start_time,
            end_time=body.end_time,
            scope=body.scope,
            sensor_ids=body.sensor_ids,
            region_type=body.region_type,
            bounding_box=body.bounding_box,
            polygon_points=polygon_points,
            fused_track_id=body.fused_track_id,
            unique_id=body.unique_id,
            attr_range=body.attr_range,
            sea_fusion_filter=body.sea_fusion_filter,
            air_fusion_filter=body.air_fusion_filter,
            display_sensor_ids=body.display_sensor_ids,
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

        result = get_sharpness(
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

    result = trigger_visibility_check(
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

    result = get_visibility(target=target, camera_entity_id=camera_entity_id)
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

    result = trigger_true_north_pointing_eval(
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

    result = get_true_north_pointing_result(
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
