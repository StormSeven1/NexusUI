"""
NexusUI 工具定义与服务端执行逻辑。
工具由 LLM 决定调用，在 FastAPI 服务端执行后将结果返回 LLM 继续推理。
"""

import math
from typing import Any

TRACKS = [
    {"id": "TRK-001", "name": "空中目标-001", "type": "air", "disposition": "hostile", "lat": 51.3201, "lng": -2.2103, "altitude": 3200, "speed": 420, "heading": 185, "sensor": "雷达 Alpha", "lastUpdate": "14:02:39", "starred": True},
    {"id": "TRK-002", "name": "空中目标-002", "type": "air", "disposition": "hostile", "lat": 51.2890, "lng": -1.9834, "altitude": 2800, "speed": 385, "heading": 210, "sensor": "雷达 Alpha", "lastUpdate": "14:02:40", "starred": False},
    {"id": "TRK-003", "name": "空中目标-003", "type": "air", "disposition": "friendly", "lat": 51.5074, "lng": -2.3576, "altitude": 5500, "speed": 550, "heading": 90, "sensor": "雷达 Bravo", "lastUpdate": "14:02:41", "starred": True},
    {"id": "TRK-004", "name": "水中目标-001", "type": "underwater", "disposition": "hostile", "lat": 50.7200, "lng": -1.8700, "speed": 18, "heading": 315, "sensor": "声呐 A", "lastUpdate": "14:02:35", "starred": False},
    {"id": "TRK-005", "name": "空中目标-004", "type": "air", "disposition": "friendly", "lat": 51.4000, "lng": -2.7100, "altitude": 4200, "speed": 480, "heading": 45, "sensor": "雷达 Bravo", "lastUpdate": "14:02:41", "starred": True},
    {"id": "TRK-006", "name": "水面目标-001", "type": "sea", "disposition": "neutral", "lat": 50.6300, "lng": -2.1500, "speed": 12, "heading": 270, "sensor": "AIS 海岸站", "lastUpdate": "14:02:30", "starred": False},
    {"id": "TRK-007", "name": "水中目标-002", "type": "underwater", "disposition": "friendly", "lat": 51.1000, "lng": -2.0200, "speed": 25, "heading": 160, "sensor": "声呐 B", "lastUpdate": "14:02:37", "starred": True},
    {"id": "TRK-008", "name": "空中目标-005", "type": "air", "disposition": "friendly", "lat": 51.6200, "lng": -2.1000, "altitude": 6100, "speed": 510, "heading": 120, "sensor": "雷达 Charlie", "lastUpdate": "14:02:40", "starred": False},
    {"id": "TRK-009", "name": "水面目标-002", "type": "sea", "disposition": "neutral", "lat": 50.5800, "lng": -2.5200, "speed": 6, "heading": 90, "sensor": "AIS 海岸站", "lastUpdate": "14:02:28", "starred": False},
]

TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "navigate_to_location",
            "description": "在地图上导航到指定经纬度坐标，可选缩放级别",
            "parameters": {
                "type": "object",
                "properties": {
                    "lat": {"type": "number", "description": "纬度"},
                    "lng": {"type": "number", "description": "经度"},
                    "zoom": {"type": "number", "description": "缩放级别，1-18"},
                },
                "required": ["lat", "lng"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_track",
            "description": "选中指定 ID 的目标进行查看，ID 格式如 TRK-001",
            "parameters": {
                "type": "object",
                "properties": {"trackId": {"type": "string", "description": "目标 ID，如 TRK-001"}},
                "required": ["trackId"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "switch_map_mode",
            "description": "切换地图显示模式为 2D 或 3D",
            "parameters": {
                "type": "object",
                "properties": {"mode": {"type": "string", "enum": ["2d", "3d"], "description": "地图模式"}},
                "required": ["mode"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_panel",
            "description": "打开系统面板。可选面板：overview(概览)、dashboard(仪表)、comm(通信)、environment(环境)、eventlog(日志)、datatable(数据)",
            "parameters": {
                "type": "object",
                "properties": {
                    "panel": {"type": "string", "enum": ["overview", "dashboard", "comm", "environment", "eventlog", "datatable"], "description": "面板名称"},
                    "side": {"type": "string", "enum": ["left", "right"], "description": "左侧或右侧面板", "default": "right"},
                },
                "required": ["panel"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_tracks",
            "description": "查询当前态势中的目标列表，可按类型或态势属性筛选",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["air", "sea", "underwater", "all"], "description": "目标类型筛选"},
                    "disposition": {"type": "string", "enum": ["hostile", "friendly", "neutral", "all"], "description": "敌我属性筛选"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "highlight_tracks",
            "description": "在地图上高亮显示一组目标（脉冲光晕效果），可按 ID 列表或按筛选条件批量高亮。传入空列表或不传参数可清除高亮。",
            "parameters": {
                "type": "object",
                "properties": {
                    "trackIds": {"type": "array", "items": {"type": "string"}, "description": "要高亮的目标 ID 列表，如 [\"TRK-001\", \"TRK-002\"]"},
                    "type": {"type": "string", "enum": ["air", "sea", "underwater", "all"], "description": "按目标类型批量高亮（与 trackIds 二选一）"},
                    "disposition": {"type": "string", "enum": ["hostile", "friendly", "neutral", "all"], "description": "按敌我属性批量高亮（与 trackIds 二选一）"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fly_to_track",
            "description": "飞行到指定目标并居中显示（带平滑动画），同时选中该目标",
            "parameters": {
                "type": "object",
                "properties": {
                    "trackId": {"type": "string", "description": "目标 ID，如 TRK-002"},
                    "zoom": {"type": "number", "description": "到达后的缩放级别，1-18，默认 12"},
                },
                "required": ["trackId"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "draw_route",
            "description": "在地图上绘制一条路线（折线），可连接多个目标或自定义坐标点。路线会以醒目颜色标绘在地图上。",
            "parameters": {
                "type": "object",
                "properties": {
                    "trackIds": {"type": "array", "items": {"type": "string"}, "description": "按目标 ID 顺序连线，如 [\"TRK-004\", \"TRK-002\"]"},
                    "points": {"type": "array", "items": {"type": "object", "properties": {"lat": {"type": "number"}, "lng": {"type": "number"}}, "required": ["lat", "lng"]}, "description": "自定义坐标点列表（与 trackIds 二选一）"},
                    "color": {"type": "string", "description": "路线颜色，CSS 颜色值，默认 #38bdf8（天蓝色）"},
                    "label": {"type": "string", "description": "路线标注名称"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "measure_distance",
            "description": "测量两个目标或坐标之间的直线距离",
            "parameters": {
                "type": "object",
                "properties": {
                    "from": {"type": "string", "description": "起点目标 ID（如 TRK-001）或 'lat,lng' 格式坐标"},
                    "to": {"type": "string", "description": "终点目标 ID（如 TRK-002）或 'lat,lng' 格式坐标"},
                },
                "required": ["from", "to"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "clear_annotations",
            "description": "清除地图上的所有标绘（路线、高亮等注记），恢复默认显示",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def _resolve_point(ref: str) -> dict[str, Any] | None:
    track = next((t for t in TRACKS if t["id"] == ref), None)
    if track:
        return {"lat": track["lat"], "lng": track["lng"], "name": track["name"]}
    try:
        parts = ref.split(",")
        return {"lat": float(parts[0].strip()), "lng": float(parts[1].strip())}
    except (ValueError, IndexError):
        return None


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    earth_radius_km = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return earth_radius_km * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def execute_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    if name == "navigate_to_location":
        lat, lng = args["lat"], args["lng"]
        zoom = args.get("zoom", 12)
        return {"action": "navigate_to_location", "lat": lat, "lng": lng, "zoom": zoom, "message": f"已导航至 {lat:.4f}, {lng:.4f}"}

    if name == "select_track":
        track_id = args["trackId"]
        track = next((t for t in TRACKS if t["id"] == track_id), None)
        if not track:
            return {"action": "select_track", "success": False, "message": f"未找到目标 {track_id}"}
        return {"action": "select_track", "success": True, "trackId": track_id, "track": track, "message": f"已选中 {track['name']} ({track_id})"}

    if name == "switch_map_mode":
        mode = args["mode"]
        return {"action": "switch_map_mode", "mode": mode, "message": f"地图已切换至 {mode.upper()} 模式"}

    if name == "open_panel":
        panel = args["panel"]
        side = args.get("side", "right")
        return {"action": "open_panel", "panel": panel, "side": side, "message": f"已打开{'右侧' if side == 'right' else '左侧'}面板: {panel}"}

    if name == "query_tracks":
        filtered = TRACKS
        target_type = args.get("type")
        disposition = args.get("disposition")
        if target_type and target_type != "all":
            filtered = [track for track in filtered if track["type"] == target_type]
        if disposition and disposition != "all":
            filtered = [track for track in filtered if track["disposition"] == disposition]
        return {"action": "query_tracks", "count": len(filtered), "tracks": filtered, "message": f"查询到 {len(filtered)} 个目标"}

    if name == "highlight_tracks":
        track_ids = args.get("trackIds", [])
        target_type = args.get("type")
        disposition = args.get("disposition")
        if not track_ids and (target_type or disposition):
            filtered = TRACKS
            if target_type and target_type != "all":
                filtered = [track for track in filtered if track["type"] == target_type]
            if disposition and disposition != "all":
                filtered = [track for track in filtered if track["disposition"] == disposition]
            track_ids = [track["id"] for track in filtered]
        matched = [track for track in TRACKS if track["id"] in track_ids]
        if not track_ids:
            return {"action": "highlight_tracks", "trackIds": [], "count": 0, "message": "已清除所有高亮"}
        return {
            "action": "highlight_tracks",
            "trackIds": track_ids,
            "count": len(matched),
            "tracks": matched,
            "message": f"已高亮 {len(matched)} 个目标",
        }

    if name == "fly_to_track":
        track_id = args["trackId"]
        zoom = args.get("zoom", 12)
        track = next((t for t in TRACKS if t["id"] == track_id), None)
        if not track:
            return {"action": "fly_to_track", "success": False, "message": f"未找到目标 {track_id}"}
        return {
            "action": "fly_to_track",
            "success": True,
            "trackId": track_id,
            "track": track,
            "lat": track["lat"],
            "lng": track["lng"],
            "zoom": zoom,
            "message": f"正在飞向 {track['name']} ({track_id})",
        }

    if name == "draw_route":
        color = args.get("color", "#38bdf8")
        label = args.get("label", "路线")
        points: list[dict[str, Any]] = []
        if args.get("trackIds"):
            for track_id in args["trackIds"]:
                point = _resolve_point(track_id)
                if point:
                    points.append(point)
        elif args.get("points"):
            points = args["points"]
        return {"action": "draw_route", "count": len(points), "points": points, "color": color, "label": label, "message": f"已绘制 {len(points)} 个航点的路线"}

    if name == "measure_distance":
        start = _resolve_point(args["from"])
        end = _resolve_point(args["to"])
        if not start or not end:
            return {"action": "measure_distance", "success": False, "message": "无法解析起点或终点"}
        distance_km = _haversine(start["lat"], start["lng"], end["lat"], end["lng"])
        return {
            "action": "measure_distance",
            "success": True,
            "from": start,
            "to": end,
            "distanceKm": round(distance_km, 2),
            "message": f"距离约 {distance_km:.2f} km",
        }

    if name == "clear_annotations":
        return {"action": "clear_annotations", "message": "已清除地图标绘"}

    return {"action": name, "success": False, "message": f"未知工具 {name}"}
