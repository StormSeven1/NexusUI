"""
资产查询工具：查询我方传感器资产（雷达、摄像头、无人机等）。
"""

from typing import Any

from sqlalchemy import select

from app.core.db_sync import get_sync_session
from app.models.asset import Asset
from app.services.tool_registry import registry


@registry.handler("query_assets")
def handle_query_assets(args: dict[str, Any]) -> dict[str, Any]:
    asset_type = args.get("type", "all")
    status = args.get("status", "all")

    with get_sync_session() as session:
        stmt = select(Asset)
        if asset_type and asset_type != "all":
            stmt = stmt.where(Asset.asset_type == asset_type)
        if status and status != "all":
            stmt = stmt.where(Asset.status == status)
        assets = session.execute(stmt).scalars().all()

    result_assets = []
    for a in assets:
        entry: dict[str, Any] = {
            "id": a.id,
            "name": a.name,
            "type": a.asset_type,
            "status": a.status,
            "lat": a.lat,
            "lng": a.lng,
        }
        if a.range_km is not None:
            entry["range_km"] = a.range_km
        if a.heading is not None:
            entry["heading"] = a.heading
        if a.fov_angle is not None:
            entry["fov_angle"] = a.fov_angle
        result_assets.append(entry)

    return {
        "action": "query_assets",
        "success": True,
        "count": len(result_assets),
        "assets": result_assets,
        "message": f"查询到 {len(result_assets)} 个资产",
    }
