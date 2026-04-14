"""
资产分配工具：将可用资产（无人机、相机等）分配去监控指定目标，或召回资产。
"""

from typing import Any

from sqlalchemy import select

from app.core.db_sync import get_sync_session
from app.models.asset import Asset
from app.services.tool_handlers._geo import haversine
from app.services.tool_registry import registry


def _get_tracks() -> list[dict[str, Any]]:
    from app.services.simulation import sim_engine
    return sim_engine.get_tracks()


_ASSET_SPEEDS_KMH: dict[str, float] = {
    "drone": 200.0,
    "camera": 0.0,   # 不移动，只转向
    "tower": 0.0,
    "radar": 0.0,
    "satellite": 0.0,
}


@registry.handler("assign_asset")
def handle_assign_asset(args: dict[str, Any]) -> dict[str, Any]:
    target_id = args["target_id"]
    asset_id = args.get("asset_id")
    asset_type_pref = args.get("asset_type", "any")

    tracks = _get_tracks()
    target = next((t for t in tracks if t["id"] == target_id), None)
    if not target:
        return {"action": "assign_asset", "success": False,
                "message": f"未找到目标 {target_id}"}

    with get_sync_session() as session:
        if asset_id:
            asset = session.execute(select(Asset).where(Asset.id == asset_id)).scalar_one_or_none()
            if not asset:
                return {"action": "assign_asset", "success": False,
                        "message": f"未找到资产 {asset_id}"}
            if asset.mission_status != "idle":
                return {"action": "assign_asset", "success": False,
                        "message": f"资产 {asset.name} 当前状态为 {asset.mission_status}，无法分配"}
            if asset.status != "online":
                return {"action": "assign_asset", "success": False,
                        "message": f"资产 {asset.name} 状态为 {asset.status}，无法执行任务"}
        else:
            stmt = select(Asset).where(
                Asset.status == "online",
                Asset.mission_status == "idle",
            )
            if asset_type_pref and asset_type_pref != "any":
                stmt = stmt.where(Asset.asset_type == asset_type_pref)
            candidates = list(session.execute(stmt).scalars().all())
            if not candidates:
                return {"action": "assign_asset", "success": False,
                        "message": f"没有可用的{'无人机' if asset_type_pref == 'drone' else '资产'}"}

            # 选择距离目标最近的
            best = min(candidates, key=lambda a: haversine(a.lat, a.lng, target["lat"], target["lng"]))
            asset = best

        dist = haversine(asset.lat, asset.lng, target["lat"], target["lng"])
        speed = _ASSET_SPEEDS_KMH.get(asset.asset_type, 0)
        eta_min = (dist / speed * 60) if speed > 0 else 0

        is_mobile = asset.asset_type in ("drone",)
        asset.mission_status = "en_route" if is_mobile else "monitoring"
        asset.assigned_target_id = target_id
        asset.target_lat = target["lat"]
        asset.target_lng = target["lng"]

        # 固定传感器（相机/塔台）分配时自动转向目标
        if not is_mobile:
            import math
            lat1_r = math.radians(asset.lat)
            lat2_r = math.radians(target["lat"])
            dlng_r = math.radians(target["lng"] - asset.lng)
            x = math.sin(dlng_r) * math.cos(lat2_r)
            y = math.cos(lat1_r) * math.sin(lat2_r) - math.sin(lat1_r) * math.cos(lat2_r) * math.cos(dlng_r)
            asset.heading = math.degrees(math.atan2(x, y)) % 360

        session.commit()

        if is_mobile:
            from app.services.simulation import sim_engine
            sim_engine.start_asset_mission(asset.id, target["lat"], target["lng"])

        return {
            "action": "assign_asset",
            "success": True,
            "assetId": asset.id,
            "assetName": asset.name,
            "assetType": asset.asset_type,
            "targetId": target_id,
            "targetName": target["name"],
            "distance_km": round(dist, 1),
            "eta_minutes": round(eta_min, 1) if eta_min > 0 else None,
            "missionStatus": asset.mission_status,
            "message": (
                f"已派遣 {asset.name} 前往 {target['name']}，距离 {dist:.1f}km"
                + (f"，预计 {eta_min:.0f} 分钟到达" if eta_min > 0 else "，已开始监控")
            ),
        }


@registry.handler("recall_asset")
def handle_recall_asset(args: dict[str, Any]) -> dict[str, Any]:
    asset_id = args["asset_id"]

    with get_sync_session() as session:
        asset = session.execute(select(Asset).where(Asset.id == asset_id)).scalar_one_or_none()
        if not asset:
            return {"action": "recall_asset", "success": False,
                    "message": f"未找到资产 {asset_id}"}

        if asset.mission_status == "idle":
            return {"action": "recall_asset", "success": False,
                    "message": f"资产 {asset.name} 当前无任务"}

        old_target = asset.assigned_target_id
        asset.mission_status = "idle"
        asset.assigned_target_id = None
        asset.target_lat = None
        asset.target_lng = None
        session.commit()

        from app.services.simulation import sim_engine
        sim_engine.cancel_asset_mission(asset.id)

        return {
            "action": "recall_asset",
            "success": True,
            "assetId": asset.id,
            "assetName": asset.name,
            "previousTarget": old_target,
            "message": f"已召回 {asset.name}，任务终止",
        }
