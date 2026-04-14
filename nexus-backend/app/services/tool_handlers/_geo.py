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


def destination_point(lat: float, lng: float, distance_km: float, bearing_deg: float) -> tuple[float, float]:
    """
    从起点沿给定方位角行进一定距离，计算终点坐标（球面近似）。
    Compute destination point on a sphere (great-circle).
    
    - bearing: 0=北，顺时针 / 0=north, clockwise
    - distance_km: 千米 / kilometers
    
    @param lat 起点纬度 / start latitude
    @param lng 起点经度 / start longitude
    @param distance_km 距离（千米） / distance in km
    @param bearing_deg 方位角（度） / bearing in degrees
    @returns (lat, lng) 终点坐标 / destination (lat, lng)
    """
    earth_radius_km = 6371.0
    brng = math.radians(bearing_deg)
    lat1 = math.radians(lat)
    lng1 = math.radians(lng)
    ang = distance_km / earth_radius_km

    sin_lat1 = math.sin(lat1)
    cos_lat1 = math.cos(lat1)
    sin_ang = math.sin(ang)
    cos_ang = math.cos(ang)

    lat2 = math.asin(sin_lat1 * cos_ang + cos_lat1 * sin_ang * math.cos(brng))
    lng2 = lng1 + math.atan2(
        math.sin(brng) * sin_ang * cos_lat1,
        cos_ang - sin_lat1 * math.sin(lat2),
    )

    # 归一化经度到 [-180, 180]
    lng2_deg = (math.degrees(lng2) + 540) % 360 - 180
    return (math.degrees(lat2), lng2_deg)


def circle_points(lat: float, lng: float, radius_km: float, segments: int = 256) -> list[dict[str, float]]:
    """
    生成圆形多边形的顶点点集（用于地图标绘），默认 256 段保证观感圆润。
    Generate polygon points approximating a circle (geodesic), default 256 segments for smoothness.

    @param lat 圆心纬度 / center latitude
    @param lng 圆心经度 / center longitude
    @param radius_km 半径（千米） / radius in kilometers
    @param segments 分段数（>=16 推荐），越大越圆 / number of segments
    @returns 点列表，每项为 {lat,lng} / list of points {lat,lng}
    """
    seg = max(16, int(segments))
    pts: list[dict[str, float]] = []
    for i in range(seg):
        brng = (i / seg) * 360.0
        dlat, dlng = destination_point(lat, lng, radius_km, brng)
        pts.append({"lat": dlat, "lng": dlng})
    return pts
