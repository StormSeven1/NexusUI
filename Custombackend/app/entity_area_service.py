"""
区域/航线实体注册辅助。

这里统一由 Custombackend 负责：
- 生成 area / route 实体 payload
- 调用后端配置中的实体注册 / 删除地址
- 前端不再感知实体服务地址

后端职责边界：
- 浏览器前端绝不直接访问实体服务
- 实体注册/删除地址只存在于后端配置中
- 只有当 `/areas` 先完成数据库写入后，才会进入本模块继续注册实体
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from math import asin, atan2, cos, radians, sin, sqrt
from typing import Any, Dict, List, Optional

import aiohttp

from config import get_settings


def area_entity_id(group_id: int, area_id: int) -> str:
    return f"area-{group_id}-{area_id}"


def route_entity_id(group_id: int, area_id: int) -> str:
    return f"route-{group_id}-{area_id}"


def map_entity_id(group_id: int, area_id: int, area_type: int) -> str:
    return route_entity_id(group_id, area_id) if int(area_type) == 4 else area_entity_id(group_id, area_id)


def iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def add_years(dt: datetime, years: int) -> datetime:
    try:
        return dt.replace(year=dt.year + years)
    except ValueError:
        return dt.replace(month=2, day=28, year=dt.year + years)


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 6371000.0
    d_lat = radians(lat2 - lat1)
    d_lng = radians(lng2 - lng1)
    a = sin(d_lat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lng / 2) ** 2
    return radius * 2 * atan2(sqrt(a), sqrt(1 - a))


def polyline_length_meters(points: List[Dict[str, float]]) -> float:
    if len(points) < 2:
        return 0.0
    total = 0.0
    for idx in range(1, len(points)):
        prev = points[idx - 1]
        cur = points[idx]
        total += haversine_meters(prev["lat"], prev["lng"], cur["lat"], cur["lng"])
    return total


def parse_csv_numbers(raw: str) -> List[float]:
    parts = [segment.strip() for segment in str(raw or "").split(",") if segment.strip()]
    values: List[float] = []
    for part in parts:
        values.append(float(part))
    return values


def parse_lat_lng_pair(raw: str) -> Optional[Dict[str, float]]:
    nums = parse_csv_numbers(raw)
    if len(nums) < 2:
        return None
    return {"lat": nums[0], "lng": nums[1]}


def coords_from_area_points(raw: str, min_n: int) -> Optional[List[Dict[str, float]]]:
    nums = parse_csv_numbers(raw)
    if len(nums) < 1 + min_n * 2:
        return None
    n = int(nums[0])
    if n < min_n or len(nums) < 1 + n * 2:
        return None
    points: List[Dict[str, float]] = []
    for idx in range(n):
        lat = nums[1 + idx * 2]
        lng = nums[2 + idx * 2]
        points.append({"lat": lat, "lng": lng})
    return points


def close_polygon(points: List[Dict[str, float]]) -> List[Dict[str, float]]:
    if not points:
        return points
    first = points[0]
    last = points[-1]
    if first["lat"] == last["lat"] and first["lng"] == last["lng"]:
        return points
    return [*points, {"lat": first["lat"], "lng": first["lng"]}]


def polygon_from_rect(area_rect: str) -> Optional[List[Dict[str, float]]]:
    nums = parse_csv_numbers(area_rect)
    if len(nums) < 4:
        return None
    lat1, lng1, lat2, lng2 = nums[:4]
    min_lat, max_lat = min(lat1, lat2), max(lat1, lat2)
    min_lng, max_lng = min(lng1, lng2), max(lng1, lng2)
    return close_polygon([
        {"lat": min_lat, "lng": min_lng},
        {"lat": min_lat, "lng": max_lng},
        {"lat": max_lat, "lng": max_lng},
        {"lat": max_lat, "lng": min_lng},
    ])


def build_area_geometry(area_type: int, row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    altitude = {"min": 0, "max": 1000}
    if area_type == 1:
        ring = polygon_from_rect(str(row.get("area_rect") or ""))
        if not ring:
            return None
        return {
            "type": "Polygon",
            "coordinates": [[point["lat"], point["lng"]] for point in ring],
            "altitude": altitude,
        }
    if area_type == 2:
        center = parse_lat_lng_pair(str(row.get("start_point") or ""))
        edge = parse_lat_lng_pair(str(row.get("end_point") or ""))
        if not center or not edge:
            return None
        radius = haversine_meters(center["lat"], center["lng"], edge["lat"], edge["lng"])
        if radius <= 0:
            return None
        return {
            "type": "Circle",
            "coordinates": [[center["lat"], center["lng"]]],
            "radius": radius,
            "altitude": altitude,
        }
    if area_type == 3:
        ring = coords_from_area_points(str(row.get("area_points") or ""), 3)
        if not ring:
            return None
        return {
            "type": "Polygon",
            "coordinates": [[point["lat"], point["lng"]] for point in close_polygon(ring)],
            "altitude": altitude,
        }
    return None


def build_area_publish_entity(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    area_type = int(row["area_type"])
    if area_type == 4:
        return None
    geometry = build_area_geometry(area_type, row)
    if not geometry:
        return None

    now = datetime.now(timezone.utc)
    created_time = iso_utc(now)
    expiry_time = iso_utc(add_years(now, 3))
    group_id = int(row["group_id"])
    area_id = int(row["area_id"])
    area_name = str(row["area_name"])
    line_color = str(row.get("line_color") or "#3b82f6")
    line_width = int(row.get("line_width") or 2)

    return {
        "entityId": area_entity_id(group_id, area_id),
        "isLive": True,
        "createdTime": created_time,
        "expiryTime": expiry_time,
        "noExpiry": True,
        "aliases": {
            "name": area_name,
            "alternateIds": [{"type": "ALT_ID_TYPE_ZONE", "id": f"ZONE{group_id}{area_id}"}],
        },
        "ontology": {
            "template": "TEMPLATE_AREA",
            "platformType": "PLATFORM_TYPE_FIXED_GROUND",
            "specificType": "SURVEILLANCE_AREA",
        },
        "milView": {
            "disposition": "DISPOSITION_FRIENDLY",
            "environment": "ENVIRONMENT_LAND",
        },
        "health": {
            "healthStatus": "HEALTH_STATUS_HEALTHY",
            "components": [],
        },
        "areaParameters": {
            "groupId": str(group_id),
            "areaId": str(area_id),
            "type": "AREA_TYPE_CUSTOM",
            "geometry": geometry,
            "properties": {
                "priority": 1,
                "validTime": {"start": created_time, "end": expiry_time},
                "accessLevel": "UNRESTRICTED",
                "tags": ["custom"],
                "description": area_name,
                "alertLevel": 0,
                "display": {
                    "lineWidth": line_width,
                    "lineColor": line_color,
                    "fillColor": f"{line_color}33",
                    "isSelected": False,
                },
            },
            "status": "AREA_STATUS_ACTIVE",
            "geoDetails": {
                "type": "GEO_TYPE_INVALID",
                "controlArea": {"type": "CONTROL_AREA_TYPE_INVALID"},
                "acm": {"acmType": "ACM_DETAIL_TYPE_INVALID", "acmDescription": ""},
            },
            "schedules": {"schedules": []},
        },
    }


def build_route_publish_entity(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    points = coords_from_area_points(str(row.get("area_points") or ""), 2)
    if not points or len(points) < 2:
        return None

    now = datetime.now(timezone.utc)
    created_time = iso_utc(now)
    expiry_time = iso_utc(add_years(now, 3))
    route_created_ms = int(now.timestamp() * 1000)
    group_id = int(row["group_id"])
    area_id = int(row["area_id"])
    route_name = str(row["area_name"])
    first = points[0]
    last = points[-1]
    total_distance = round(polyline_length_meters(points))
    waypoint_count = len(points)
    estimated_time = max(60, round(total_distance / 5))

    return {
        "entityId": route_entity_id(group_id, area_id),
        "routeId": f"{group_id}_{area_id}",
        "isLive": True,
        "createdTime": created_time,
        "expiryTime": expiry_time,
        "noExpiry": True,
        "routeCreatedTime": route_created_ms,
        "aliases": {
            "name": route_name,
            "alternateIds": [{"type": "ALT_ID_TYPE_ROUTE", "id": f"ROUTE{group_id}{area_id}"}],
        },
        "ontology": {
            "template": "TEMPLATE_ROUTE",
            "platformType": "PLATFORM_TYPE_FIXED_GROUND",
            "specificType": "PATROL_ROUTE",
        },
        "milView": {
            "disposition": "DISPOSITION_FRIENDLY",
            "environment": "ENVIRONMENT_MARITIME",
        },
        "health": {
            "healthStatus": "HEALTH_STATUS_HEALTHY",
            "components": [],
        },
        "routeParameters": {
            "djiRouteFileId": "",
            "updateTime": route_created_ms,
            "summary": {
                "startPoint": {"latitude": first["lat"], "longitude": first["lng"], "height": 0},
                "endPoint": {"latitude": last["lat"], "longitude": last["lng"], "height": 0},
                "waypointCount": waypoint_count,
                "estimatedTime": estimated_time,
                "totalDistance": total_distance,
                "maxHeight": 0,
            },
            "routeDetails": {
                "destinationName": route_name,
                "estimatedArrivalTime": expiry_time,
            },
        },
    }


async def publish_area_entity(row: Dict[str, Any]) -> Dict[str, Any]:
    settings = get_settings()
    body = (
        build_route_publish_entity(row)
        if int(row["area_type"]) == 4
        else build_area_publish_entity(row)
    )
    if not body:
        return {"ok": False, "error": "无法构建实体载荷"}

    timeout = aiohttp.ClientTimeout(total=8)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(
            settings.ENTITY_PUBLISH_URL,
            json=body,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        ) as response:
            text = await response.text()
            data: Any = None
            try:
                data = await response.json(content_type=None)
            except Exception:
                data = {"raw": text[:500]}

    code = data.get("code") if isinstance(data, dict) else None
    message = data.get("message") if isinstance(data, dict) else None
    entity_id = body.get("entityId")
    ok = response.status < 400 and (code in (None, 0, 200) or data.get("success") is True if isinstance(data, dict) else True)
    return {
        "ok": ok,
        "status": response.status,
        "code": code,
        "message": message,
        "entityId": entity_id,
        "upstream": data,
    }


async def delete_area_entity(entity_id: str) -> Dict[str, Any]:
    settings = get_settings()
    url = settings.ENTITY_DELETE_URL_TEMPLATE.replace("{entityId}", entity_id)
    timeout = aiohttp.ClientTimeout(total=8)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.delete(url, headers={"Accept": "application/json"}) as response:
            text = await response.text()
            data: Any = None
            try:
                data = await response.json(content_type=None)
            except Exception:
                data = {"raw": text[:500]}
    ok = response.status < 400 or response.status == 404
    message = data.get("message") if isinstance(data, dict) else None
    return {"ok": ok, "status": response.status, "message": message, "upstream": data}
