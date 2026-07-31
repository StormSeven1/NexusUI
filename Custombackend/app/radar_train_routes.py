"""探鸟雷达训练真值 HTTP API（对空融合 → 自报位+探鸟批号；支持手动标为无人机）。"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from radar_train.csv_recorder import capture_manager
from radar_train.label_store import label_store

router = APIRouter(prefix="/radar-train-labels", tags=["radar-train-labels"])


class BatchLookupRequest(BaseModel):
    pihaos: List[int] = Field(..., min_length=1, description="探鸟雷达批号列表")


class MarkUavRequest(BaseModel):
    """地图右键：对空融合航迹标为无人机（按探鸟批号写入真值表）。"""

    pihao: int = Field(..., gt=0, description="探鸟雷达批号（fusionSources 探鸟 trackId）")
    fuse_unique_id: Optional[Any] = None
    fuse_track_id: Optional[Any] = None
    show_id: Optional[str] = None
    bird_radar_source_name: Optional[str] = None
    bird_radar_data_source_id: Optional[str] = None
    fusion_sources: Optional[List[Dict[str, Any]]] = None


class UnmarkUavRequest(BaseModel):
    pihao: int = Field(..., gt=0, description="探鸟雷达批号")


@router.get("")
async def list_labels(active_only: bool = Query(True)):
    """当前内存中的无人机真值批号（默认剔除 TTL 过期）。"""
    if active_only:
        label_store.prune_expired()
    items = label_store.list_active()
    return JSONResponse(
        content={
            "code": 200,
            "count": len(items),
            "items": items,
            "timestamp": datetime.now().isoformat(),
        }
    )


@router.get("/stats")
async def label_stats():
    return JSONResponse(content={"code": 200, **label_store.stats(), "timestamp": datetime.now().isoformat()})


@router.get("/export/csv")
async def export_csv():
    """导出当前有效真值表，供 start.py / csv_to_train_table 关联 label_gt。"""
    rows = label_store.export_csv_rows()
    buf = io.StringIO()
    fieldnames = [
        "pihao",
        "label_gt",
        "label_str",
        "label_source",
        "bird_radar_track_id",
        "self_report_track_ids",
        "fuse_unique_id",
        "fuse_track_id",
        "first_seen",
        "last_seen",
        "update_count",
    ]
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    buf.seek(0)
    filename = f"radar_uav_gt_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/mark-uav")
async def mark_uav(body: MarkUavRequest):
    """手动将探鸟批号标为无人机；采集中 CSV 的 is_uav 等相关字段会按此批号写入。"""
    entry: Dict[str, Any] = {
        "pihao": int(body.pihao),
        "label_gt": 1,
        "label_str": "无人机",
        "label_source": "manual:fuse_air",
        "manual": True,
        "bird_radar_track_id": int(body.pihao),
        "bird_radar_source_name": (body.bird_radar_source_name or "").strip(),
        "bird_radar_data_source_id": (body.bird_radar_data_source_id or "").strip(),
        "self_report_track_ids": [],
        "fuse_unique_id": body.fuse_unique_id,
        "fuse_track_id": body.fuse_track_id,
        "show_id": (body.show_id or "").strip() or None,
        "fusion_sources": body.fusion_sources or [],
    }
    row = label_store.upsert(entry)
    capture_manager.touch_qualifying_track(int(body.pihao))
    return JSONResponse(
        content={
            "code": 200,
            "ok": True,
            "message": f"已标为无人机（批号 {body.pihao}）",
            "item": row,
            "timestamp": datetime.now().isoformat(),
        }
    )


@router.post("/unmark-uav")
async def unmark_uav(body: UnmarkUavRequest):
    removed = label_store.clear_manual(int(body.pihao))
    if not removed:
        return JSONResponse(
            status_code=404,
            content={
                "code": 404,
                "ok": False,
                "message": f"批号 {body.pihao} 无手动无人机标记",
                "timestamp": datetime.now().isoformat(),
            },
        )
    capture_manager._refresh_uav_pihaos()
    return JSONResponse(
        content={
            "code": 200,
            "ok": True,
            "message": f"已取消无人机标记（批号 {body.pihao}）",
            "item": removed,
            "timestamp": datetime.now().isoformat(),
        }
    )


@router.get("/{pihao}")
async def get_label(pihao: int):
    row = label_store.get(pihao)
    if not row:
        return JSONResponse(
            status_code=404,
            content={
                "code": 404,
                "message": f"批号 {pihao} 暂无真值（需对空融合同时含自报位+探鸟雷达，或手动标为无人机）",
                "timestamp": datetime.now().isoformat(),
            },
        )
    return JSONResponse(content={"code": 200, "item": row, "timestamp": datetime.now().isoformat()})


@router.post("/lookup")
async def batch_lookup(body: BatchLookupRequest):
    found = label_store.lookup_batch(body.pihaos)
    return JSONResponse(
        content={
            "code": 200,
            "requested": len(body.pihaos),
            "found": len(found),
            "labels": found,
            "timestamp": datetime.now().isoformat(),
        }
    )
