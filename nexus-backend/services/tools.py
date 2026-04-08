"""
NexusUI 工具定义与服务端执行逻辑。
工具由 LLM 决定调用，在 FastAPI 服务端执行后将结果返回 LLM 继续推理。
"""

import json
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
]


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

    return {"action": name, "success": False, "message": f"未知工具: {name}"}
