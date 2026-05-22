"""
系统评估 HTTP 转发（对接 system-evaluation-server gRPC）。
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from loguru import logger

from config import get_settings
from system_eval_perf_client import fetch_system_response_time_stats

router = APIRouter(prefix="/system-eval", tags=["system-eval"])


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
