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

import grpc
from google.protobuf.json_format import MessageToDict

from config import get_settings
from grpc_services.entity.proto_codegen import load_entity_proto_modules


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


def _fill_aliases(target: Any, data: Dict[str, Any]) -> None:
    aliases = data.get("aliases") or {}
    target.aliases.name = str(aliases.get("name") or "")
    for item in aliases.get("alternateIds") or []:
        alt = target.aliases.alternate_ids.add()
        alt.type = str(item.get("type") or "")
        alt.id = str(item.get("id") or "")


def _fill_common_entity_fields(target: Any, data: Dict[str, Any]) -> None:
    target.entity_id = str(data.get("entityId") or "")
    target.is_live = 1 if data.get("isLive") else 0
    target.created_time = str(data.get("createdTime") or "")
    target.expiry_time = str(data.get("expiryTime") or "")
    target.no_expiry = bool(data.get("noExpiry"))
    _fill_aliases(target, data)

    ontology = data.get("ontology") or {}
    target.ontology.str_template = str(ontology.get("template") or "")
    target.ontology.platform_type = str(ontology.get("platformType") or "")
    target.ontology.specific_type = str(ontology.get("specificType") or "")

    mil_view = data.get("milView") or {}
    target.mil_view.disposition = str(mil_view.get("disposition") or "")
    target.mil_view.environment = str(mil_view.get("environment") or "")

    health = data.get("health") or {}
    target.health.health_status = str(health.get("healthStatus") or "")


def _build_area_entity_pb(entity_pb2: Any, data: Dict[str, Any]) -> Any:
    entity = entity_pb2.Entity()
    area = entity.area_entity
    _fill_common_entity_fields(area, data)

    params_data = data.get("areaParameters") or {}
    params = area.area_parameters
    params.group_id = str(params_data.get("groupId") or "")
    params.area_id = str(params_data.get("areaId") or "")
    params.type = str(params_data.get("type") or "")
    params.status = str(params_data.get("status") or "")

    geometry_data = params_data.get("geometry") or {}
    params.geometry.type = str(geometry_data.get("type") or "")
    for item in geometry_data.get("coordinates") or []:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            point = params.geometry.coordinates.add()
            point.latitude_degrees = float(item[0])
            point.longitude_degrees = float(item[1])
    altitude = geometry_data.get("altitude") or {}
    params.geometry.altitude.min = float(altitude.get("min") or 0)
    params.geometry.altitude.max = float(altitude.get("max") or 0)

    props_data = params_data.get("properties") or {}
    params.properties.priority = int(props_data.get("priority") or 0)
    params.properties.access_level = str(props_data.get("accessLevel") or "")
    params.properties.description = str(props_data.get("description") or "")
    params.properties.alert_level = int(props_data.get("alertLevel") or 0)
    params.properties.tags.extend([str(item) for item in props_data.get("tags") or []])
    valid_time = props_data.get("validTime") or {}
    params.properties.valid_time.start = str(valid_time.get("start") or "")
    params.properties.valid_time.end = str(valid_time.get("end") or "")
    display = props_data.get("display") or {}
    params.properties.display.line_width = float(display.get("lineWidth") or 0)
    params.properties.display.line_color = str(display.get("lineColor") or "")
    params.properties.display.fill_color = str(display.get("fillColor") or "")
    params.properties.display.is_selected = bool(display.get("isSelected"))

    geo_details = params_data.get("geoDetails") or {}
    params.geo_details.type = str(geo_details.get("type") or "")
    params.geo_details.control_area.type = str((geo_details.get("controlArea") or {}).get("type") or "")
    acm = geo_details.get("acm") or {}
    params.geo_details.acm.acm_type = str(acm.get("acmType") or "")
    params.geo_details.acm.acm_description = str(acm.get("acmDescription") or "")
    return entity


def _build_route_entity_pb(entity_pb2: Any, data: Dict[str, Any], row: Dict[str, Any]) -> Any:
    entity = entity_pb2.Entity()
    route = entity.route_entity
    _fill_common_entity_fields(route, data)

    params_data = data.get("routeParameters") or {}
    params = route.route_parameters
    params.route_type = "waypoint"
    params.route_attribute = "mission_route"
    params.finish_action = "goHome"
    params.execute_rc_lost_action = "goBack"
    params.auto_flight_speed = 5.0
    params.gimbal_pitch_mode = "usePointSetting"

    points = coords_from_area_points(str(row.get("area_points") or ""), 2) or []
    if points:
        params.take_off_ref_point = f'{points[0]["lng"]},{points[0]["lat"]},0'
    for index, point_data in enumerate(points):
        point = params.way_point_list.add()
        point.index = index
        point.latitude = float(point_data["lat"])
        point.longitude = float(point_data["lng"])
        point.height = 0.0
        point.speed = 5.0

    route_details = params_data.get("routeDetails") or {}
    params.route_details.destination_name = str(route_details.get("destinationName") or "")
    params.route_details.estimated_arrival_time = str(route_details.get("estimatedArrivalTime") or "")
    return entity


def _build_entity_pb(entity_pb2: Any, data: Dict[str, Any], row: Dict[str, Any]) -> Any:
    if int(row["area_type"]) == 4:
        return _build_route_entity_pb(entity_pb2, data, row)
    return _build_area_entity_pb(entity_pb2, data)


def _grpc_target(settings: Any) -> str:
    return f"{settings.ENTITY_GRPC_HOST}:{int(settings.ENTITY_GRPC_PORT)}"


def _grpc_response_dict(response: Any) -> Dict[str, Any]:
    try:
        return MessageToDict(response, preserving_proto_field_name=False)
    except TypeError:
        return {"code": int(getattr(response, "code", 0)), "message": getattr(response, "message", "")}


async def _single_register_entity(settings: Any, entity_pb: Any) -> Any:
    _, _, entity_pb2, entity_pb2_grpc = load_entity_proto_modules()
    channel = grpc.aio.insecure_channel(_grpc_target(settings))
    try:
        stub = entity_pb2_grpc.EntityServiceStub(channel)
        request = entity_pb2.SingleRegisterEntityRequest(entity=entity_pb)
        method = getattr(stub, settings.ENTITY_GRPC_REGISTER_METHOD)
        return await method(request, timeout=float(settings.ENTITY_GRPC_TIMEOUT_SECONDS))
    finally:
        await channel.close()


async def _delete_entity(settings: Any, entity_id: str) -> Any:
    _, _, entity_pb2, entity_pb2_grpc = load_entity_proto_modules()
    channel = grpc.aio.insecure_channel(_grpc_target(settings))
    try:
        stub = entity_pb2_grpc.EntityServiceStub(channel)
        request = entity_pb2.DeleteEntityRequest(entityId=entity_id)
        method = getattr(stub, settings.ENTITY_GRPC_DELETE_METHOD)
        return await method(request, timeout=float(settings.ENTITY_GRPC_TIMEOUT_SECONDS))
    finally:
        await channel.close()


async def publish_area_entity(row: Dict[str, Any]) -> Dict[str, Any]:
    settings = get_settings()
    body = (
        build_route_publish_entity(row)
        if int(row["area_type"]) == 4
        else build_area_publish_entity(row)
    )
    if not body:
        return {"ok": False, "error": "无法构建实体载荷"}

    _, _, entity_pb2, _ = load_entity_proto_modules()
    entity_pb = _build_entity_pb(entity_pb2, body, row)
    response = await _single_register_entity(settings, entity_pb)
    data = _grpc_response_dict(response)
    code = int(getattr(response, "code", 0))
    message = getattr(response, "message", "")
    entity_id = body.get("entityId")
    ok = code in (0, 200)
    return {
        "ok": ok,
        "code": code,
        "message": message,
        "entityId": entity_id,
        "upstream": data,
    }


async def delete_area_entity(entity_id: str) -> Dict[str, Any]:
    settings = get_settings()
    response = await _delete_entity(settings, entity_id)
    data = _grpc_response_dict(response)
    code = int(getattr(response, "code", 0))
    message = getattr(response, "message", "")
    ok = code in (0, 200, 404)
    return {"ok": ok, "code": code, "message": message, "upstream": data}
