"""
地图操作类工具：导航、切换模式、打开面板、绘制路线、清除标绘、绘制区域。
"""

from typing import Any

from app.services.tool_handlers._geo import resolve_point
from app.services.tool_registry import registry


def _get_tracks() -> list[dict[str, Any]]:
    from app.services.simulation import sim_engine
    return sim_engine.get_tracks()


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
    """返回地图空间上下文：限制区域、目标位置，供 LLM 空间推理使用。"""
    from app.services.simulation import sim_engine

    include_zones = args.get("include_zones", True)
    include_tracks = args.get("include_tracks", True)

    result: dict[str, Any] = {"action": "query_map_context", "success": True}

    if include_zones:
        zones = sim_engine.get_zones()
        zone_summaries = []
        for z in zones:
            summary: dict[str, Any] = {
                "id": z["id"],
                "name": z["name"],
                "type": z["type"],
            }
            if "bbox" in z:
                summary["bbox"] = z["bbox"]
            if "center" in z:
                summary["center"] = z["center"]
            if "coordinates" in z:
                summary["coordinates_lnglat"] = z["coordinates"]
            zone_summaries.append(summary)
        result["zones"] = zone_summaries

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

    result["message"] = f"返回 {len(result.get('zones', []))} 个区域、{len(result.get('tracks', []))} 个目标的地图上下文"
    return result


@registry.handler("draw_area")
def handle_draw_area(args: dict[str, Any]) -> dict[str, Any]:
    points = args.get("points", [])
    if len(points) < 3:
        return {"action": "draw_area", "success": False, "message": "多边形至少需要 3 个顶点"}
    color = args.get("color", "#f59e0b")
    fill_color = args.get("fillColor", color)
    fill_opacity = args.get("fillOpacity", 0.15)
    label = args.get("label", "标绘区域")
    return {
        "action": "draw_area",
        "success": True,
        "points": points,
        "color": color,
        "fillColor": fill_color,
        "fillOpacity": fill_opacity,
        "label": label,
        "message": f"已标绘区域「{label}」（{len(points)} 个顶点）",
    }
