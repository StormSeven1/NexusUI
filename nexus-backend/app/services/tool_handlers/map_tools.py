"""
地图操作类工具：导航、切换模式、打开面板、绘制路线、清除标绘、绘制区域、查询地图上下文。
"""

import json
import uuid
from typing import Any

from sqlalchemy import select

from app.core.db_sync import get_sync_session
from app.models.asset import Asset
from app.models.zone import Zone
from app.services.tool_handlers._geo import resolve_point, circle_points
from app.services.tool_registry import registry


def _get_tracks() -> list[dict[str, Any]]:
    from app.services.simulation import sim_engine
    return sim_engine.get_tracks()


def _compute_bbox(coords: list[list[float]]) -> dict[str, Any]:
    """从 [lng, lat] 坐标列表计算边界框和中心点。"""
    if not coords:
        return {}
    lngs = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return {
        "bbox": {"south": min(lats), "north": max(lats), "west": min(lngs), "east": max(lngs)},
        "center": {"lat": (min(lats) + max(lats)) / 2, "lng": (min(lngs) + max(lngs)) / 2},
    }


@registry.handler("navigate_to_location")
def handle_navigate(args: dict[str, Any]) -> dict[str, Any]:
    lat, lng = args["lat"], args["lng"]
    zoom = args.get("zoom", 12)
    return {
        "action": "navigate_to_location",
        "lat": lat,
        "lng": lng,
        "zoom": zoom,
        "message": f"已导航至 {lat:.4f}, {lng:.4f}",
    }


@registry.handler("switch_map_mode")
def handle_switch_map_mode(args: dict[str, Any]) -> dict[str, Any]:
    mode = args["mode"]
    return {"action": "switch_map_mode", "mode": mode, "message": f"地图已切换至 {mode.upper()} 模式"}


@registry.handler("open_panel")
def handle_open_panel(args: dict[str, Any]) -> dict[str, Any]:
    panel = args["panel"]
    side = args.get("side", "right")
    label = "右侧" if side == "right" else "左侧"
    return {"action": "open_panel", "panel": panel, "side": side, "message": f"已打开{label}面板: {panel}"}


@registry.handler("draw_route")
def handle_draw_route(args: dict[str, Any]) -> dict[str, Any]:
    color = args.get("color", "#38bdf8")
    label = args.get("label", "路线")
    points: list[dict[str, Any]] = []
    if args.get("trackIds"):
        for track_id in args["trackIds"]:
            point = resolve_point(track_id, _get_tracks)
            if point:
                points.append(point)
    elif args.get("points"):
        points = args["points"]
    return {
        "action": "draw_route",
        "count": len(points),
        "points": points,
        "color": color,
        "label": label,
        "message": f"已绘制 {len(points)} 个航点的路线",
    }


@registry.handler("measure_distance")
def handle_measure_distance(args: dict[str, Any]) -> dict[str, Any]:
    from app.services.tool_handlers._geo import haversine

    start = resolve_point(args["from"], _get_tracks)
    end = resolve_point(args["to"], _get_tracks)
    if not start or not end:
        return {"action": "measure_distance", "success": False, "message": "无法解析起点或终点"}
    distance_km = haversine(start["lat"], start["lng"], end["lat"], end["lng"])
    return {
        "action": "measure_distance",
        "success": True,
        "from": start,
        "to": end,
        "distanceKm": round(distance_km, 2),
        "message": f"距离约 {distance_km:.2f} km",
    }


@registry.handler("clear_annotations")
def handle_clear_annotations(args: dict[str, Any]) -> dict[str, Any]:
    return {"action": "clear_annotations", "message": "已清除地图标绘"}


@registry.handler("query_map_context")
def handle_query_map_context(args: dict[str, Any]) -> dict[str, Any]:
    """返回地图空间上下文：从 DB 读取区域和资产，从仿真引擎读取目标位置。"""
    include_zones = args.get("include_zones", True)
    include_tracks = args.get("include_tracks", True)
    include_assets = args.get("include_assets", True)

    result: dict[str, Any] = {"action": "query_map_context", "success": True}

    with get_sync_session() as session:
        if include_zones:
            zones = session.execute(select(Zone)).scalars().all()
            zone_summaries = []
            for z in zones:
                coords = json.loads(z.coordinates) if z.coordinates else []
                geo = _compute_bbox(coords)
                zone_summaries.append({
                    "id": z.id, "name": z.name, "type": z.zone_type, "source": z.source,
                    **geo,
                    "coordinates_lnglat": coords,
                })
            result["zones"] = zone_summaries

        if include_assets:
            assets = session.execute(select(Asset)).scalars().all()
            result["assets"] = [
                {
                    "id": a.id, "name": a.name, "type": a.asset_type,
                    "status": a.status, "lat": a.lat, "lng": a.lng,
                    "range_km": a.range_km, "fov_angle": a.fov_angle,
                }
                for a in assets
            ]

    if include_tracks:
        tracks = _get_tracks()
        result["tracks"] = [
            {
                "id": t["id"], "name": t["name"], "type": t["type"],
                "disposition": t["disposition"],
                "lat": round(t["lat"], 4), "lng": round(t["lng"], 4),
            }
            for t in tracks
        ]

    z_count = len(result.get("zones", []))
    a_count = len(result.get("assets", []))
    t_count = len(result.get("tracks", []))
    result["message"] = f"返回 {z_count} 个区域、{a_count} 个资产、{t_count} 个目标的地图上下文"
    return result


def _is_circle_intent(args: dict[str, Any]) -> bool:
    """
    判断 LLM 是否想画圆：显式 shape=circle，或提供了 center+radius_km。
    Detect circle intent: explicit shape=circle or center+radius_km present.
    """
    if (args.get("shape") or "").lower() == "circle":
        return True
    if args.get("center") and args.get("radius_km") is not None:
        return True
    return False


def _filter_bad_points(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    过滤掉明显异常的坐标点（如 lat=0 且 lng=0），防止 LLM 生成残缺数据。
    Filter obviously invalid coords (e.g. (0,0)) produced by LLM truncation.
    """
    return [
        p for p in points
        if not (abs(p.get("lat", 0)) < 0.0001 and abs(p.get("lng", 0)) < 0.0001)
    ]


@registry.handler("draw_area")
def handle_draw_area(args: dict[str, Any]) -> dict[str, Any]:
    """
    区域标绘：支持多边形(points)以及圆形(shape=circle / center+radius_km)。
    自动检测圆形意图，过滤 (0,0) 异常点。
    """
    segments = args.get("segments", 256)

    if _is_circle_intent(args):
        center = args.get("center") or {}
        radius_km = args.get("radius_km")
        try:
            c_lat = float(center.get("lat"))  # type: ignore[union-attr]
            c_lng = float(center.get("lng"))  # type: ignore[union-attr]
            r_km = float(radius_km)  # type: ignore[arg-type]
        except (TypeError, ValueError, AttributeError):
            return {"action": "draw_area", "success": False,
                    "message": "圆形标绘需要 center{lat,lng} 与 radius_km"}
        if r_km <= 0:
            return {"action": "draw_area", "success": False, "message": "radius_km 必须大于 0"}
        points = circle_points(c_lat, c_lng, r_km, int(segments) if segments is not None else 256)
    else:
        points = _filter_bad_points(args.get("points") or [])
        if len(points) < 3:
            return {"action": "draw_area", "success": False,
                    "message": "多边形至少需要 3 个有效顶点（已过滤 (0,0) 等异常坐标）"}

    color = args.get("color", "#f59e0b")
    fill_color = args.get("fillColor", color)
    fill_opacity = args.get("fillOpacity", 0.15)
    label = args.get("label", "标绘区域")

    coords_lnglat = [[p["lng"], p["lat"]] for p in points]

    zone_id = f"area-{uuid.uuid4().hex[:8]}"
    with get_sync_session() as session:
        zone = Zone(
            id=zone_id,
            name=label,
            zone_type="search",
            source="ai",
            coordinates=json.dumps(coords_lnglat),
            color=color,
            fill_color=fill_color,
            fill_opacity=fill_opacity,
        )
        session.add(zone)
        session.commit()

    return {
        "action": "draw_area",
        "success": True,
        "zone_id": zone_id,
        "points": points,
        "color": color,
        "fillColor": fill_color,
        "fillOpacity": fill_opacity,
        "label": label,
        "message": f"已标绘区域「{label}」（{len(points)} 个顶点）并保存到数据库",
    }
