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

        for record in _relationship_record_list(data):
            parent_id = _edge_parent_id(record)
            child_id = _edge_child_id(record)
            if not parent_id or not child_id:
                continue
            relationship_id = _safe_str(record.get("relationshipId") or record.get("id"))
            edges.append(
                {
                    "parent": parent_id,
                    "child": child_id,
                    "relationshipId": relationship_id or f"parent-{parent_id}-and-child-{child_id}",
                }
            )
            for node_id in (parent_id, child_id):
                if node_id in node_map:
                    continue
                entity = entity_lookup.get(node_id, {})
                node_map[node_id] = {
                    "id": node_id,
                    "name": _safe_str(entity.get("name") or node_id),
                    "assetType": _safe_str(entity.get("assetType")),
                    "deviceSn": _safe_str(entity.get("deviceSn")),
                    "virtualTroop": bool(entity.get("virtualTroop") is True),
                    "disposition": _safe_str(entity.get("disposition")),
                    "lat": entity.get("lat"),
                    "lng": entity.get("lng"),
                }

        return {"nodes": list(node_map.values()), "edges": edges}
    except Exception as exc:
        logger.error(f"Failed to parse relationship payload: {exc}", exc_info=True)
        return None
