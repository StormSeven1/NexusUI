"""探鸟雷达训练真值 HTTP API（对空融合 → 自报位+探鸟批号）。"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from radar_train.label_store import label_store

router = APIRouter(prefix="/radar-train-labels", tags=["radar-train-labels"])


class BatchLookupRequest(BaseModel):
    pihaos: List[int] = Field(..., min_length=1, description="探鸟雷达批号列表")


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


@router.get("/{pihao}")
async def get_label(pihao: int):
    row = label_store.get(pihao)
    if not row:
        return JSONResponse(
            status_code=404,
            content={
                "code": 404,
                "message": f"批号 {pihao} 暂无真值（需对空融合同时含自报位+探鸟雷达）",
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
