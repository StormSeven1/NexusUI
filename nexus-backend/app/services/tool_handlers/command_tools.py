"""
资产指令控制工具：移动无人机、转向相机、开始巡逻。
"""

import math
from typing import Any

from sqlalchemy import select

from app.core.db_sync import get_sync_session
from app.models.asset import Asset
from app.services.tool_handlers._geo import haversine, resolve_point
from app.services.tool_registry import registry


def _get_tracks() -> list[dict[str, Any]]:
    from app.services.simulation import sim_engine
    return sim_engine.get_tracks()


@registry.handler("command_asset")
def handle_command_asset(args: dict[str, Any]) -> dict[str, Any]:
    asset_id = args["asset_id"]
    command = args["command"]

    with get_sync_session() as session:
        asset = session.execute(select(Asset).where(Asset.id == asset_id)).scalar_one_or_none()
        if not asset:
            return {"action": "command_asset", "success": False,
                    "message": f"未找到资产 {asset_id}"}
        if asset.status != "online":
            return {"action": "command_asset", "success": False,
                    "message": f"资产 {asset.name} 状态为 {asset.status}，无法执行指令"}

        from app.services.simulation import sim_engine

        if command == "move_to":
            if asset.asset_type not in ("drone",):
                return {"action": "command_asset", "success": False,
                        "message": f"{asset.name} 是固定资产（{asset.asset_type}），不支持移动指令"}
            target_ref = args.get("target")
            if not target_ref:
                return {"action": "command_asset", "success": False,
                        "message": "move_to 指令需要 target 参数"}

            point = resolve_point(target_ref, _get_tracks)
            if not point:
                return {"action": "command_asset", "success": False,
                        "message": f"无法解析目标位置: {target_ref}"}

            dist = haversine(asset.lat, asset.lng, point["lat"], point["lng"])
            asset.mission_status = "en_route"
            asset.target_lat = point["lat"]
            asset.target_lng = point["lng"]
            # 如果 target 是一个 track ID，记录关联
            if point.get("name"):
                asset.assigned_target_id = target_ref if target_ref.startswith("TRK") else None
            session.commit()

            sim_engine.start_asset_mission(asset.id, point["lat"], point["lng"])

            return {
                "action": "command_asset",
                "success": True,
                "assetId": asset.id,
                "assetName": asset.name,
                "command": command,
                "destination": {"lat": point["lat"], "lng": point["lng"]},
                "distance_km": round(dist, 1),
                "message": f"{asset.name} 正在前往目标位置，距离 {dist:.1f}km",
            }

        elif command == "aim_at":
            target_ref = args.get("target")
            if not target_ref:
                return {"action": "command_asset", "success": False,
                        "message": "aim_at 指令需要 target 参数"}

            point = resolve_point(target_ref, _get_tracks)
            if not point:
                return {"action": "command_asset", "success": False,
                        "message": f"无法解析目标位置: {target_ref}"}

            lat1_r = math.radians(asset.lat)
            lat2_r = math.radians(point["lat"])
            dlng_r = math.radians(point["lng"] - asset.lng)
            x = math.sin(dlng_r) * math.cos(lat2_r)
            y = math.cos(lat1_r) * math.sin(lat2_r) - math.sin(lat1_r) * math.cos(lat2_r) * math.cos(dlng_r)
            bearing = math.degrees(math.atan2(x, y)) % 360

            asset.heading = bearing
            asset.mission_status = "monitoring"
            session.commit()

            return {
                "action": "command_asset",
                "success": True,
                "assetId": asset.id,
                "assetName": asset.name,
                "command": command,
                "newHeading": round(bearing, 1),
                "message": f"{asset.name} 已转向 {bearing:.0f}°，对准目标",
            }

        elif command == "start_patrol":
            waypoints_raw = args.get("waypoints", [])
            if not waypoints_raw:
                return {"action": "command_asset", "success": False,
                        "message": "start_patrol 需要 waypoints 参数"}

            waypoints = []
            for wp in waypoints_raw:
                if isinstance(wp, dict):
                    waypoints.append({"lat": wp["lat"], "lng": wp["lng"]})
                elif isinstance(wp, str):
                    pt = resolve_point(wp, _get_tracks)
                    if pt:
                        waypoints.append({"lat": pt["lat"], "lng": pt["lng"]})

            if len(waypoints) < 2:
                return {"action": "command_asset", "success": False,
                        "message": "巡逻路线至少需要 2 个航路点"}

            asset.mission_status = "en_route"
            asset.target_lat = waypoints[0]["lat"]
            asset.target_lng = waypoints[0]["lng"]
            session.commit()

            sim_engine.start_asset_patrol(asset.id, waypoints)

            return {
                "action": "command_asset",
                "success": True,
                "assetId": asset.id,
                "assetName": asset.name,
                "command": command,
                "waypointCount": len(waypoints),
                "message": f"{asset.name} 开始巡逻路线，共 {len(waypoints)} 个航路点",
            }

        else:
            return {"action": "command_asset", "success": False,
                    "message": f"未知指令: {command}"}
