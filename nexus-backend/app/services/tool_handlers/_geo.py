"""
地理计算公共函数，供多个 handler 模块使用。
"""

from __future__ import annotations

import math
from typing import Any


def resolve_point(ref: str, get_tracks: Any = None) -> dict[str, Any] | None:
    """
    将目标 ID 或 'lat,lng' 字符串解析为坐标字典。
    get_tracks 可传入 callable 返回当前目标列表（支持模拟引擎动态数据）。
    """
    if get_tracks is not None:
        tracks = get_tracks() if callable(get_tracks) else get_tracks
        track = next((t for t in tracks if t["id"] == ref), None)
        if track:
            return {"lat": track["lat"], "lng": track["lng"], "name": track["name"]}
    try:
        parts = ref.split(",")
        return {"lat": float(parts[0].strip()), "lng": float(parts[1].strip())}
    except (ValueError, IndexError):
        return None


def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """返回两点之间的大圆距离（千米）。"""
    earth_radius_km = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    )
    return earth_radius_km * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
