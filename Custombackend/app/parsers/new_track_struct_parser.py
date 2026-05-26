"""
TargetOutputSet (NewTrackStruct) → 前端航迹字典。

IDL TargetObject:
  - target_kinematics: 位置 / target_orientation / speed
  - fused_azimuth_deg / fused_elevation_deg / fused_range_m: 相对融合中心极坐标
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Union

from loguru import logger

ParseResult = Union[Dict[str, Any], List[Dict[str, Any]], None]

# classified_type (trackType) → trackCategoryName，与 IDL UnitType 枚举值一致
_TRACK_TYPE_TO_CATEGORY_NAME: Dict[int, str] = {
    0: 'unknown',
    1: 'uav',
    2: 'bird',
    3: 'helicopter',
    4: 'aircraft',
    5: 'missile',
    6: 'buoy',
    7: 'ship',
    8: 'submarine',
    9: 'ground_vehicle',
    10: 'person',
    11: 'animal',
    12: 'other',
}


def _fusion_source_name_from_radar(sp, entity_id: str) -> Optional[str]:
    if not sp.has_radar_source():
        return None
    rtp = sp.radar_source().target_profile()
    fs = rtp.fusionSources()
    for i in range(len(fs)):
        fi = fs[i]
        if str(fi.dataSourceId()) == str(entity_id):
            n = fi.sourceName()
            return str(n) if n else None
    return None


def _read_reality_type(obj) -> int:
    """
    IDL RealityType：0 未知(UNKNOWN_REALITY)，1 实兵(REAL)，2 虚兵(VIRTUAL)。
    融合目标 TargetObject.reality_type → WS 字段 reality_type。
    """
    if not hasattr(obj, 'reality_type'):
        return 0
    try:
        raw = obj.reality_type()
        if hasattr(raw, 'value'):
            return int(raw.value)
        return int(raw)
    except (TypeError, ValueError) as e:
        logger.warning(f"TargetObject.reality_type 解析失败，按 0(未知) 下发: {e}")
        return 0


def _extract_fusion_sources(obj) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    sources = obj.sources()
    for i in range(len(sources)):
        src = sources[i]
        ds_id = str(src.entity_id() or '').strip()
        tid_raw = src.source_track_id()
        sp = src.source_profile()
        name = _fusion_source_name_from_radar(sp, ds_id) if ds_id else None
        if not name:
            name = 'AIS' if ds_id.lower() == 'ais' else ds_id
        out.append({
            'sourceName': name,
            'dataSourceId': ds_id,
            'trackId': int(tid_raw) if str(tid_raw).strip().isdigit() else tid_raw,
        })
    return out


def target_object_to_track(obj) -> Dict[str, Any]:
    """单个 TargetObject → 前端航迹 dict；类型名仅由 trackType(classified_type) 决定。"""
    track_type = int(obj.classified_type())
    track_category_name = _TRACK_TYPE_TO_CATEGORY_NAME[track_type]

    kin = obj.target_kinematics()
    pos = kin.position()
    orient = kin.target_orientation()

    ts = float(obj.last_update_time())
    if ts <= 0:
        ts = float(obj.created_time())

    reality_type = _read_reality_type(obj)

    result: Dict[str, Any] = {
        'trackId': int(obj.external_target_id()) if str(obj.external_target_id()).strip().isdigit() else obj.external_target_id(),
        'uniqueId': int(obj.target_id()) if str(obj.target_id()).strip().isdigit() else obj.target_id(),
        'longitude': float(pos.longitude()),
        'latitude': float(pos.latitude()),
        'height': float(pos.altitude()),
        'altitude': float(pos.altitude()),
        'course': float(orient.yaw()),
        'pitch': float(orient.pitch()),
        'roll': float(orient.roll()),
        'speed': float(kin.speed()),
        'azimuth': float(obj.fused_azimuth_deg()),
        'elevation': float(obj.fused_elevation_deg()),
        'range': float(obj.fused_range_m()),
        'timestamp': ts,
        'trackType': track_type,
        'classified_type': track_type,
        'trackCategoryName': track_category_name,
        'trackAlias': str(obj.name()),
        'confidence': float(obj.type_confidence()),
        'reality_type': reality_type,
        'source': 'DDS',
        'data_type': 'fusion_track',
        'structure_type': 'new_track_struct',
    }
    if reality_type == 2:
        result['is_virtual'] = True
        result['virtualTroop'] = True
    if track_type == 1:
        result['is_uav'] = True
        result['isUav'] = True

    fusion_sources = _extract_fusion_sources(obj)
    if fusion_sources:
        result['fusionSources'] = fusion_sources
        result['reserved6'] = json.dumps(fusion_sources, ensure_ascii=False)
        for fs in fusion_sources:
            if str(fs.get('dataSourceId', '')).lower() == 'ais':
                result['mmsi'] = fs.get('trackId')
                break

    return result


def parse_target_output_set(output_set) -> Optional[List[Dict[str, Any]]]:
    """TargetOutputSet → 航迹 dict 列表。"""
    targets = output_set.targets()
    return [target_object_to_track(targets[i]) for i in range(len(targets))]
