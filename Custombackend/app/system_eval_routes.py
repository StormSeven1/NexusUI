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

router = APIRouter(prefix="/system-eval", tags=["system-eval"])


class TrackEvalRequest(BaseModel):
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    scope: str = "BOTH"
    sensor_ids: Optional[List[int]] = None
    region_type: str = ""
    bounding_box: Optional[Dict[str, float]] = None
    polygon: Optional[Dict[str, Any]] = Field(default=None, description="含 points 数组")


@router.get("/perf")
async def get_system_perf_stats(limit: int = Query(10, ge=1, le=100)):
    """
    系统性能评估：转发 PerformanceEvaluationService.GetSystemResponseTimeStats。
    """
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


@router.post("/track/evaluate")
async def post_track_evaluate(body: TrackEvalRequest = Body(...)):
    """
    航迹质量评估：转发 TrackEvaluationService.EvaluateTrackQuality。
    """
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
