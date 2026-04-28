"""
实体状态解析器 - 解析实体API返回的数据
"""
from typing import Dict, List, Optional, Any
from loguru import logger
from datetime import datetime


def _get_alt_id(entity: Dict[str, Any], id_type: str) -> Optional[str]:
    """从实体的 alternateIds 中取指定类型的 id"""
    aliases = entity.get("aliases") or {}
    alt_ids = aliases.get("alternateIds") or []
    for item in alt_ids:
        if isinstance(item, dict) and item.get("type") == id_type:
            return item.get("id")
    return None


def _build_relationships(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    从实体列表构建 relationships，只保留 airports 一个结构。
    每个 airport 的 drones 数组里放该机场下无人机的完整信息（deviceSn、name、位置等），
    前端可从 airports 自行推导 drone_to_airport / airport_to_drones，无需后端再发。
    机场 SN 与对应关系来自实体中同时带 DEVICE_SN 和 GATEWAY_SN 的 alternateIds；
    机场位置取自关联 UAV 的 airportLatitudeDegrees/airportLongitudeDegrees（或经纬度）。
    """
    drone_to_airport: Dict[str, str] = {}
    airport_to_drones: Dict[str, List[str]] = {}
    # 无人机 SN -> 名称、位置等，便于后面给机场挂载无人机名称
    drone_info: Dict[str, Dict[str, Any]] = {}
    # 机场 SN -> 任选一个关联 UAV 的机场位置/状态（用于拼机场项）
    airport_by_sn: Dict[str, Dict[str, Any]] = {}

    # 第一轮：遍历所有实体，找出同时带有 DEVICE_SN 和 GATEWAY_SN 的（无人机↔机场关系）
    for entity in records:
        entity_id = (entity.get("entityId") or "").strip()
        name = (entity.get("aliases") or {}).get("name") or ""
        device_sn = _get_alt_id(entity, "DEVICE_SN")
        gateway_sn = _get_alt_id(entity, "GATEWAY_SN")
        if not device_sn or not gateway_sn:
            continue
        drone_to_airport[device_sn] = gateway_sn
        airport_to_drones.setdefault(gateway_sn, []).append(device_sn)
        position = (entity.get("location") or {}).get("position") or {}
        # 机场位置：优先用机场经纬度，否则用当前经纬度
        lat = position.get("airportLatitudeDegrees") if position.get("airportLatitudeDegrees") is not None else position.get("latitudeDegrees")
        lon = position.get("airportLongitudeDegrees") if position.get("airportLongitudeDegrees") is not None else position.get("longitudeDegrees")
        drone_info[device_sn] = {
            "deviceSn": device_sn,
            "name": name or device_sn,
            "gatewaySn": gateway_sn,
            "entityId": entity_id,
            "latitude": position.get("latitudeDegrees"),
            "longitude": position.get("longitudeDegrees"),
            "altitudeHaeMeters": position.get("altitudeHaeMeters"),
        }
        # 为每个机场 SN 保留一条“代表”数据（位置优先用机场经纬度，温湿度等从 flightParameters 取）
        fp = entity.get("flightParameters") or {}
        if gateway_sn not in airport_by_sn and (lat is not None or lon is not None):
            airport_by_sn[gateway_sn] = {
                "latitude": lat,
                "longitude": lon,
                "height": position.get("altitudeHaeMeters") or 0,
                "droneInDock": fp.get("droneInDock", False),
                "temperature": fp.get("airportTemperature"),
                "humidity": fp.get("airportHumidity"),
            }
        elif gateway_sn in airport_by_sn and position.get("airportLatitudeDegrees") is not None and position.get("airportLongitudeDegrees") is not None:
            # 若已有记录但当前 UAV 带机场经纬度，则用机场经纬度覆盖
            airport_by_sn[gateway_sn]["latitude"] = position.get("airportLatitudeDegrees")
            airport_by_sn[gateway_sn]["longitude"] = position.get("airportLongitudeDegrees")

    # 第二轮：为每个出现过的机场 SN 生成机场项，drones 里放完整无人机信息（可从 airports 推导出 drone_to_airport / airport_to_drones）
    airports: List[Dict[str, Any]] = []
    for dock_sn, base in airport_by_sn.items():
        drone_sns = airport_to_drones.get(dock_sn, [])
        drones_full = [drone_info[sn] for sn in drone_sns if sn in drone_info]
        airports.append({
            "dockSn": dock_sn,
            "entityId": f"dock_{dock_sn}",
            "name": dock_sn,
            "latitude": base["latitude"],
            "longitude": base["longitude"],
            "height": base["height"],
            "droneInDock": base["droneInDock"],
            "temperature": base["temperature"],
            "humidity": base["humidity"],
            "drones": drones_full,
        })

    return {"airports": airports}


def parse_entity_status(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    解析实体状态数据。不过滤，发送全部；不维护缓存；relationships 仅作为顶层字段下发。
    """
    try:
        if not isinstance(data, dict):
            logger.warning("实体状态数据格式错误: 不是字典类型")
            return None

        code = data.get("code")
        if code != 0:
            logger.warning(f"实体状态API返回错误码: {code}, message: {data.get('message')}")
            return None

        data_section = data.get("data", {})
        if not isinstance(data_section, dict):
            logger.warning("实体状态数据格式错误: data字段不是字典类型")
            return None

        records = data_section.get("records", [])
        if not isinstance(records, list):
            logger.warning("实体状态数据格式错误: records字段不是列表类型")
            return None

        # 构建完整关系（机场由无人机 GATEWAY_SN 推导，无 airport_ 前缀依赖）
        relationships = _build_relationships(records)

        total = data_section.get("total", 0)
        current_page = data_section.get("current", 1)
        total_pages = data_section.get("pages", 1)

        airport_count = len(relationships.get("airports", []))
        drone_count = sum(len(ap.get("drones") or []) for ap in relationships.get("airports", []))
        logger.info(
            f"解析实体状态成功: 共 {total} 个实体, "
            f"当前页 {current_page}/{total_pages}, "
            f"本次获取 {len(records)} 个实体, "
            f"关系: {airport_count} 个机场, {drone_count} 个无人机"
        )

        # 只返回 entities + relationships，不缓存、不在 cache_info 里重复放 relationships
        result = {
            "type": "entity_status",
            "timestamp": datetime.now().isoformat(),
            "total": total,
            "current_page": current_page,
            "total_pages": total_pages,
            "entities": records,
            "relationships": relationships,
        }
        return result

    except Exception as e:
        logger.error(f"解析实体状态数据失败: {e}", exc_info=True)
        return None
