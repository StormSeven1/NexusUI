"""
NexusUI 工具定义与服务端执行逻辑。
工具由 LLM 决定调用，在 FastAPI 服务端执行后将结果返回 LLM 继续推理。
"""

import json
import math
from typing import Any

TRACKS = [
    {"id": "TRK-001", "name": "不明车辆 : 疑似轿车", "type": "ground", "disposition": "unknown", "lat": 51.4545, "lng": -2.5879, "speed": 8.4, "heading": 25},
    {"id": "TRK-002", "name": "SHARK-27", "type": "air", "disposition": "hostile", "lat": 51.3201, "lng": -2.2103, "speed": 420, "heading": 185},
    {"id": "TRK-003", "name": "SHARK-31", "type": "air", "disposition": "hostile", "lat": 51.289, "lng": -1.9834, "speed": 385, "heading": 210},
    {"id": "TRK-004", "name": "BLUEJAY-12", "type": "air", "disposition": "friendly", "lat": 51.5074, "lng": -2.3576, "speed": 550, "heading": 90},
    {"id": "TRK-005", "name": "不明人员", "type": "ground", "disposition": "unknown", "lat": 51.18, "lng": -2.45, "speed": 1.0, "heading": 0},
    {"id": "TRK-006", "name": "VIPER-03", "type": "sea", "disposition": "suspect", "lat": 50.72, "lng": -1.87, "speed": 18, "heading": 315},
    {"id": "TRK-007", "name": "EAGLE-09", "type": "air", "disposition": "friendly", "lat": 51.4, "lng": -2.71, "speed": 480, "heading": 45},
    {"id": "TRK-008", "name": "货轮 MV-Horizon", "type": "sea", "disposition": "neutral", "lat": 50.63, "lng": -2.15, "speed": 12, "heading": 270},
    {"id": "TRK-009", "name": "SHADOW-15", "type": "ground", "disposition": "hostile", "lat": 51.1, "lng": -2.02, "speed": 35, "heading": 160},
    {"id": "TRK-010", "name": "人员 (TX) TV天线", "type": "ground", "disposition": "unknown", "lat": 51.05, "lng": -2.38, "speed": 0.5, "heading": 0},
    {"id": "TRK-011", "name": "FALCON-22", "type": "air", "disposition": "assumed-friend", "lat": 51.62, "lng": -2.1, "speed": 510, "heading": 120},
    {"id": "TRK-012", "name": "渔船 FV-Lucky", "type": "sea", "disposition": "neutral", "lat": 50.58, "lng": -2.52, "speed": 6, "heading": 90},
]

# OpenAI function-calling 格式的工具定义
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
                "properties": {
                    "trackId": {"type": "string", "description": "目标 ID，如 TRK-001"},
                },
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
                "properties": {
                    "mode": {"type": "string", "enum": ["2d", "3d"], "description": "地图模式"},
                },
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
                    "type": {"type": "string", "enum": ["air", "ground", "sea", "unknown", "all"], "description": "目标类型筛选"},
                    "disposition": {"type": "string", "enum": ["hostile", "friendly", "neutral", "suspect", "unknown", "assumed-friend", "all"], "description": "敌我属性筛选"},
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
                    "type": {"type": "string", "enum": ["air", "ground", "sea", "unknown", "all"], "description": "按目标类型批量高亮（与 trackIds 二选一）"},
                    "disposition": {"type": "string", "enum": ["hostile", "friendly", "neutral", "suspect", "unknown", "assumed-friend", "all"], "description": "按敌我属性批量高亮（与 trackIds 二选一）"},
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
    """将 trackId 或 'lat,lng' 字符串解析为 {lat, lng} 字典"""
    track = next((t for t in TRACKS if t["id"] == ref), None)
    if track:
        return {"lat": track["lat"], "lng": track["lng"], "name": track["name"]}
    try:
        parts = ref.split(",")
        return {"lat": float(parts[0].strip()), "lng": float(parts[1].strip())}
    except (ValueError, IndexError):
        return None


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine 公式计算两点间大圆距离（km）"""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def execute_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """服务端执行工具并返回结构化结果"""
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
        t = args.get("type")
        d = args.get("disposition")
        if t and t != "all":
            filtered = [tr for tr in filtered if tr["type"] == t]
        if d and d != "all":
            filtered = [tr for tr in filtered if tr["disposition"] == d]
        return {"action": "query_tracks", "count": len(filtered), "tracks": filtered, "message": f"查询到 {len(filtered)} 个目标"}

    if name == "highlight_tracks":
        track_ids = args.get("trackIds", [])
        t = args.get("type")
        d = args.get("disposition")
        if not track_ids and (t or d):
            filtered = TRACKS
            if t and t != "all":
                filtered = [tr for tr in filtered if tr["type"] == t]
            if d and d != "all":
                filtered = [tr for tr in filtered if tr["disposition"] == d]
            track_ids = [tr["id"] for tr in filtered]
        matched = [tr for tr in TRACKS if tr["id"] in track_ids]
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
        track_ids = args.get("trackIds", [])
        points = args.get("points", [])
        color = args.get("color", "#38bdf8")
        label = args.get("label", "")
        if track_ids:
            resolved = []
            for tid in track_ids:
                tr = next((t for t in TRACKS if t["id"] == tid), None)
                if tr:
                    resolved.append({"lat": tr["lat"], "lng": tr["lng"], "trackId": tid, "name": tr["name"]})
            points = resolved
            if not label:
                names = [p.get("name", p.get("trackId", "")) for p in resolved]
                label = " → ".join(names)
        if len(points) < 2:
            return {"action": "draw_route", "success": False, "message": "路线至少需要 2 个点"}
        return {
            "action": "draw_route",
            "success": True,
            "points": points,
            "color": color,
            "label": label,
            "message": f"已绘制路线: {label}" if label else f"已绘制 {len(points)} 点路线",
        }

    if name == "measure_distance":
        from_arg, to_arg = args["from"], args["to"]
        from_pt = _resolve_point(from_arg)
        to_pt = _resolve_point(to_arg)
        if not from_pt or not to_pt:
            missing = from_arg if not from_pt else to_arg
            return {"action": "measure_distance", "success": False, "message": f"无法解析坐标: {missing}"}
        dist_km = _haversine(from_pt["lat"], from_pt["lng"], to_pt["lat"], to_pt["lng"])
        return {
            "action": "measure_distance",
            "success": True,
            "from": from_pt,
            "to": to_pt,
            "distanceKm": round(dist_km, 2),
            "distanceNm": round(dist_km / 1.852, 2),
            "message": f"距离: {dist_km:.2f} km ({dist_km / 1.852:.2f} 海里)",
        }

    if name == "clear_annotations":
        return {"action": "clear_annotations", "message": "已清除所有地图标绘"}

    return {"action": name, "success": False, "message": f"未知工具: {name}"}
