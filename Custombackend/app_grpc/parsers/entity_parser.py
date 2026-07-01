"""
Entity API parser helpers.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from loguru import logger


def _as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def _safe_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _safe_number(value: Any) -> Optional[float]:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    return num


def _first_present(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def _nested_get(source: Dict[str, Any], *path: str) -> Any:
    current: Any = source
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _read_power_capacity(entity: Dict[str, Any]) -> Optional[float]:
    source_map = _nested_get(entity, "power", "sourceIdToState")
    if not isinstance(source_map, dict):
        return None

    preferred_keys = ("main_battery", "battery", "backup_battery")
    for key in preferred_keys:
        value = _nested_get(source_map, key, "powerLevel", "capacity")
        num = _safe_number(value)
        if num is not None:
            return num

    for state in source_map.values():
        if not isinstance(state, dict):
            continue
        value = _nested_get(state, "powerLevel", "capacity")
        num = _safe_number(value)
        if num is not None:
            return num
    return None


def _read_battery_percent(entity: Dict[str, Any], status_obj: Dict[str, Any]) -> Optional[float]:
    candidates = [
        status_obj.get("battery_percent"),
        status_obj.get("batteryPercent"),
        status_obj.get("battery_capacity_percent"),
        status_obj.get("batteryCapacityPercent"),
        status_obj.get("capacity_percent"),
        status_obj.get("capacityPercent"),
        status_obj.get("elec"),
        status_obj.get("electricQuantity"),
        status_obj.get("electric_quantity"),
        status_obj.get("power"),
        _nested_get(status_obj, "battery", "capacity_percent"),
        _nested_get(status_obj, "battery", "capacityPercent"),
        _nested_get(status_obj, "battery", "percent"),
        _nested_get(status_obj, "batteryInfo", "capacity_percent"),
        _nested_get(status_obj, "batteryInfo", "capacityPercent"),
        _nested_get(status_obj, "battery_status", "capacity_percent"),
        _nested_get(status_obj, "batteryStatus", "capacityPercent"),
        _nested_get(status_obj, "drone_charge_state", "capacity_percent"),
        _nested_get(status_obj, "droneChargeState", "capacityPercent"),
        entity.get("battery_percent"),
        entity.get("batteryPercent"),
        entity.get("battery_capacity_percent"),
        entity.get("batteryCapacityPercent"),
        entity.get("elec"),
        entity.get("electricQuantity"),
        entity.get("electric_quantity"),
        _read_power_capacity(entity),
    ]
    for value in candidates:
        num = _safe_number(value)
        if num is not None:
            return max(0.0, min(100.0, num))
    return None


def _battery_debug_values(entity: Dict[str, Any], status_obj: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "entity.battery_percent": entity.get("battery_percent"),
        "entity.batteryPercent": entity.get("batteryPercent"),
        "entity.battery_capacity_percent": entity.get("battery_capacity_percent"),
        "entity.batteryCapacityPercent": entity.get("batteryCapacityPercent"),
        "entity.elec": entity.get("elec"),
        "entity.electricQuantity": entity.get("electricQuantity"),
        "entity.electric_quantity": entity.get("electric_quantity"),
        "entity.power.sourceIdToState.main_battery.powerLevel.capacity": _nested_get(
            entity, "power", "sourceIdToState", "main_battery", "powerLevel", "capacity"
        ),
        "entity.power.sourceIdToState.backup_battery.powerLevel.capacity": _nested_get(
            entity, "power", "sourceIdToState", "backup_battery", "powerLevel", "capacity"
        ),
        "status.battery_percent": status_obj.get("battery_percent"),
        "status.batteryPercent": status_obj.get("batteryPercent"),
        "status.battery_capacity_percent": status_obj.get("battery_capacity_percent"),
        "status.batteryCapacityPercent": status_obj.get("batteryCapacityPercent"),
        "status.capacity_percent": status_obj.get("capacity_percent"),
        "status.capacityPercent": status_obj.get("capacityPercent"),
        "status.elec": status_obj.get("elec"),
        "status.electricQuantity": status_obj.get("electricQuantity"),
        "status.electric_quantity": status_obj.get("electric_quantity"),
        "status.power": status_obj.get("power"),
        "status.battery.capacity_percent": _nested_get(status_obj, "battery", "capacity_percent"),
        "status.battery.capacityPercent": _nested_get(status_obj, "battery", "capacityPercent"),
        "status.battery.percent": _nested_get(status_obj, "battery", "percent"),
        "status.batteryInfo.capacity_percent": _nested_get(status_obj, "batteryInfo", "capacity_percent"),
        "status.batteryInfo.capacityPercent": _nested_get(status_obj, "batteryInfo", "capacityPercent"),
        "status.battery_status.capacity_percent": _nested_get(status_obj, "battery_status", "capacity_percent"),
        "status.batteryStatus.capacityPercent": _nested_get(status_obj, "batteryStatus", "capacityPercent"),
        "status.drone_charge_state.capacity_percent": _nested_get(status_obj, "drone_charge_state", "capacity_percent"),
        "status.droneChargeState.capacityPercent": _nested_get(status_obj, "droneChargeState", "capacityPercent"),
    }


def _get_alt_id(entity: Dict[str, Any], id_type: str) -> str:
    aliases = _as_dict(entity.get("aliases"))
    alt_ids = _as_list(aliases.get("alternateIds"))
    for item in alt_ids:
        if not isinstance(item, dict):
            continue
        if _safe_str(item.get("type")) == id_type:
            return _safe_str(item.get("id"))
    return ""


def _normalize_asset_type(entity: Dict[str, Any]) -> str:
    ontology = _as_dict(entity.get("ontology"))
    specific = _safe_str(entity.get("specificType") or ontology.get("specificType")).upper()
    platform = _safe_str(ontology.get("platformType")).upper()

    if specific.startswith("RADAR") or "RADAR" in specific or "雷达" in specific:
        return "radar"
    if specific in {"CAMERA", "OPTOELECTRONIC", "OPTICAL"} or "CAMERA" in specific or "光电" in specific:
        return "camera"
    if specific in {"TOWER", "ESM", "EW", "RECON"} or "电侦" in specific:
        return "tower"
    if specific in {"DOCK", "AIRPORT", "GATEWAY"}:
        return "airport"
    if specific in {"DRONE", "UAV"}:
        return "drone"
    if specific in {"LASER"}:
        return "laser"
    if specific in {"TDOA"}:
        return "tdoa"
    if specific in {"MISSILE", "MUNITION"} or "飞弹" in specific or "导弹" in specific:
        return "missile"
    if specific in {"USV", "UNMANNED_SHIP"}:
        return "usv"
    if specific.endswith("AREA") or specific == "FRAME":
        return "unknown"
    if platform == "PLATFORM_TYPE_FIXED_GROUND" and specific == "GATEWAY":
        return "airport"
    return "unknown"


def _read_video_address(entity: Dict[str, Any], asset_type: str) -> str:
    media = _as_dict(entity.get("media"))
    relationship = _as_dict(entity.get("relationship"))
    relationship_media = _as_dict(relationship.get("media"))

    def read_media_address(media_obj: Dict[str, Any]) -> str:
        direct = _safe_str(media_obj.get("address"))
        if direct:
            return direct
        for item in _as_list(media_obj.get("media")):
            if not isinstance(item, dict):
                continue
            if _safe_str(item.get("type")).upper() != "MEDIA_TYPE_VIDEO":
                continue
            address = _safe_str(item.get("address")) or _safe_str(item.get("relativePath"))
            if address:
                return address
        return ""

    # 当前实体接口里，很多相机视频地址并不直接挂在 `media.address`，
    # 而是挂在 `relationship.media.address`。
    # 例如 `camera_001` / `camera_000` 在 entity.json 里就是这种结构。
    # 所以相机不能只读 `media`，必须优先尝试 `relationship.media`，再回退到 `media`。
    if asset_type == "camera":
        return read_media_address(relationship_media) or read_media_address(media)
    if asset_type == "drone":
        return read_media_address(relationship_media) or read_media_address(media)
    return read_media_address(media)


def _normalize_entity_record(entity: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    entity_id = _safe_str(entity.get("entityId"))
    if not entity_id:
        return None

    asset_type = _normalize_asset_type(entity)
    aliases = _as_dict(entity.get("aliases"))
    location = _as_dict(entity.get("location"))
    position = _as_dict(location.get("position"))
    indicators = _as_dict(entity.get("indicators"))
    mil_view = _as_dict(entity.get("milView"))
    ontology = _as_dict(entity.get("ontology"))
    status_obj = _as_dict(entity.get("status"))

    lat = _safe_number(
        _first_present(
            entity.get("lat"),
            entity.get("latitude"),
            position.get("latitudeDegrees"),
            position.get("latitude"),
        )
    )
    lng = _safe_number(
        _first_present(
            entity.get("lng"),
            entity.get("longitude"),
            position.get("longitudeDegrees"),
            position.get("longitude"),
        )
    )
    altitude = _safe_number(_first_present(position.get("altitudeHaeMeters"), position.get("altitude")))
    heading = _safe_number(_first_present(entity.get("headingDeg"), entity.get("heading"), entity.get("bearing")))

    device_sn = _get_alt_id(entity, "DEVICE_SN")
    gateway_sn = _get_alt_id(entity, "GATEWAY_SN")
    virtual_troop = bool(indicators.get("simulated") is True)
    disposition = _safe_str(mil_view.get("disposition"))
    video_address = _read_video_address(entity, asset_type)
    device_state = _safe_number(status_obj.get("deviceState"))
    battery_percent = _read_battery_percent(entity, status_obj)

    row: Dict[str, Any] = {
        "entityId": entity_id,
        "name": _safe_str(entity.get("name") or entity.get("entityName") or aliases.get("name") or entity_id),
        "assetType": asset_type,
        "virtualTroop": virtual_troop,
        "disposition": disposition,
        "lat": lat,
        "lng": lng,
        "altitudeHaeMeters": altitude,
        "headingDeg": heading,
        "deviceSn": device_sn,
        "gatewaySn": gateway_sn,
        "videoAddress": video_address,
        "status": status_obj,
        "platformActivity": _safe_str(status_obj.get("platformActivity")),
        "role": _safe_str(status_obj.get("role")),
        "deviceState": int(device_state) if device_state is not None else None,
        "battery_percent": battery_percent,
        "batteryPercent": battery_percent,
        "battery_capacity_percent": battery_percent,
        "batteryCapacityPercent": battery_percent,
        "ontology": {
            "specificType": _safe_str(ontology.get("specificType")),
            "platformType": _safe_str(ontology.get("platformType")),
        },
        "milView": {
            "disposition": disposition,
            "environment": _safe_str(mil_view.get("environment")),
        },
        "indicators": {
            "simulated": virtual_troop,
        },
    }

    # if asset_type in {"drone", "airport"}:
    #     logger.info(
    #         "entity_status battery asset_type={} entityId={} name={} deviceState={} parsed_battery_percent={} raw_battery_fields={} status_keys={}",
    #         asset_type,
    #         entity_id,
    #         row.get("name"),
    #         row.get("deviceState"),
    #         battery_percent,
    #         _battery_debug_values(entity, status_obj),
    #         list(status_obj.keys()),
    #     )

    radar_params = _as_dict(entity.get("radarParameters"))
    if radar_params:
        row["radarParameters"] = radar_params

    nav_params = _as_dict(entity.get("navigationParameters"))
    if nav_params:
        row["navigationParameters"] = nav_params

    if altitude is not None or lat is not None or lng is not None:
        row["location"] = {
            "position": {
                "latitudeDegrees": lat,
                "longitudeDegrees": lng,
                "altitudeHaeMeters": altitude,
            }
        }

    if video_address:
        row["media"] = {"address": video_address}

    return row


def parse_entities_response(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        if not isinstance(data, dict):
            logger.warning("Entity API payload is not an object")
            return None
        if data.get("code") != 0:
            logger.warning(f"Entity API returned error code={data.get('code')}, message={data.get('message')}")
            return None

        data_section = _as_dict(data.get("data"))
        records = _as_list(data_section.get("records"))
        entities: List[Dict[str, Any]] = []
        for item in records:
            if not isinstance(item, dict):
                continue
            normalized = _normalize_entity_record(item)
            if normalized is not None:
                entities.append(normalized)

        return {
            "timestamp": datetime.now().isoformat(),
            "total": int(data_section.get("total") or len(records)),
            "current_page": int(data_section.get("current") or 1),
            "total_pages": int(data_section.get("pages") or 1),
            "entities": entities,
        }
    except Exception as exc:
        logger.error(f"Failed to parse entity payload: {exc}", exc_info=True)
        return None


def _relationship_record_list(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    data_section = _as_dict(data.get("data"))
    records = data_section.get("records")
    if isinstance(records, list):
        return [item for item in records if isinstance(item, dict)]
    if isinstance(data_section, list):
        return [item for item in data_section if isinstance(item, dict)]
    if isinstance(records, dict):
        nested = _as_list(records.get("records"))
        return [item for item in nested if isinstance(item, dict)]
    return []


def _relationship_nodes_and_edges(
    data: Dict[str, Any],
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    data_section = _as_dict(data.get("data"))
    nodes = _as_list(data_section.get("nodes"))
    edges = _as_list(data_section.get("edges"))
    return (
        [item for item in nodes if isinstance(item, dict)],
        [item for item in edges if isinstance(item, dict)],
    )


def _edge_parent_id(record: Dict[str, Any]) -> str:
    return _safe_str(
        record.get("parent")
        or record.get("parentId")
        or record.get("parentEntityId")
        or record.get("sourceEntityId")
        or record.get("sourceId")
    )


def _edge_child_id(record: Dict[str, Any]) -> str:
    return _safe_str(
        record.get("child")
        or record.get("childId")
        or record.get("childEntityId")
        or record.get("targetEntityId")
        or record.get("targetId")
    )


def parse_relationships_response(
    data: Dict[str, Any],
    entities_by_id: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    try:
        if not isinstance(data, dict):
            logger.warning("Relationship API payload is not an object")
            return None
        if data.get("code") != 0:
            logger.warning(
                f"Relationship API returned error code={data.get('code')}, message={data.get('message')}"
            )
            return None

        entity_lookup = entities_by_id or {}
        node_map: Dict[str, Dict[str, Any]] = {}
        edges: List[Dict[str, Any]] = []
        raw_nodes, raw_edges = _relationship_nodes_and_edges(data)

        def upsert_node(node_id: str, seed: Optional[Dict[str, Any]] = None) -> None:
            if not node_id:
                return
            source = seed or {}
            entity = entity_lookup.get(node_id, {})
            merged = {
                **source,
                **entity,
            }
            node_map[node_id] = {
                "id": node_id,
                "name": _safe_str(
                    merged.get("name")
                    or merged.get("entityName")
                    or merged.get("displayName")
                    or node_id
                ),
                "assetType": _safe_str(merged.get("assetType") or merged.get("asset_type")),
                "deviceSn": _safe_str(merged.get("deviceSn") or merged.get("device_sn")),
                "gatewaySn": _safe_str(merged.get("gatewaySn") or merged.get("gateway_sn")),
                "virtualTroop": bool(merged.get("virtualTroop") is True),
                "disposition": _safe_str(merged.get("disposition")),
                "lat": merged.get("lat"),
                "lng": merged.get("lng"),
            }

        for record in raw_nodes:
            node_id = _safe_str(record.get("id") or record.get("entityId"))
            if not node_id:
                continue
            upsert_node(node_id, record)

        for record in raw_edges:
            parent_id = _edge_parent_id(record)
            child_id = _edge_child_id(record)
            if not parent_id or not child_id:
                continue
            relationship_id = _safe_str(
                record.get("relationshipId")
                or record.get("relationship_id")
                or record.get("id")
            )
            edges.append(
                {
                    "parent": parent_id,
                    "child": child_id,
                    "relationshipId": relationship_id or f"parent-{parent_id}-and-child-{child_id}",
                }
            )
            upsert_node(parent_id)
            upsert_node(child_id)

        for record in _relationship_record_list(data):
            parent_id = _edge_parent_id(record)
            child_id = _edge_child_id(record)
            if not parent_id or not child_id:
                continue
            relationship_id = _safe_str(
                record.get("relationshipId")
                or record.get("relationship_id")
                or record.get("id")
            )
            edges.append(
                {
                    "parent": parent_id,
                    "child": child_id,
                    "relationshipId": relationship_id or f"parent-{parent_id}-and-child-{child_id}",
                }
            )
            upsert_node(parent_id)
            upsert_node(child_id)

        return {"nodes": list(node_map.values()), "edges": edges}
    except Exception as exc:
        logger.error(f"Failed to parse relationship payload: {exc}", exc_info=True)
        return None
