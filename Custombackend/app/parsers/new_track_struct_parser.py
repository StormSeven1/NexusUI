"""
TargetOutputSet (NewTrackStruct) → 前端航迹字典。

IDL TargetObject:
  - target_kinematics: 位置 / target_orientation / speed
  - fused_azimuth_deg / fused_elevation_deg / fused_range_m: 相对融合中心极坐标
  - sources[]: 每路来源含 SourceProfile（雷达/光电/电侦/AIS/自报位画像）
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple, Union

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


def _safe_str(value: Any) -> str:
    if value is None:
        return ''
    return str(value).strip()


def _call_str(obj: Any, method: str) -> str:
    if obj is None or not hasattr(obj, method):
        return ''
    try:
        return _safe_str(getattr(obj, method)())
    except Exception:
        return ''


def _first_nonempty(*candidates: str) -> Optional[str]:
    for c in candidates:
        s = _safe_str(c)
        if s:
            return s
    return None


def _name_from_hardware_profile(hw: Any) -> Optional[str]:
    """RadarStaticProfile / EOStaticProfile / ESMStaticProfile 等硬件档案。"""
    if hw is None:
        return None
    return _first_nonempty(
        _call_str(hw, 'deployment_site_name'),
        _call_str(hw, 'sensor_model'),
        _call_str(hw, 'profile_id'),
    )


def _fusion_source_name_from_radar(sp: Any, entity_id: str) -> Optional[str]:
    if not sp.has_radar_source():
        return None
    try:
        rtp = sp.radar_source().target_profile()
        fs = rtp.fusionSources()
        for i in range(len(fs)):
            fi = fs[i]
            if _safe_str(fi.dataSourceId()) == _safe_str(entity_id):
                name = _call_str(fi, 'sourceName')
                if name:
                    return name
        return _first_nonempty(
            _call_str(rtp, 'trackAlias'),
            _call_str(rtp, 'description'),
        )
    except Exception as e:
        logger.debug(f"雷达 fusionSources 解析失败 entity_id={entity_id}: {e}")
    return None


def _fusion_source_name_from_profile(sp: Any, entity_id: str) -> Tuple[Optional[str], str]:
    """
    按 SourceProfile 开关从对应画像取展示名。
    返回 (sourceName, sourceType)；sourceType: radar|eo|esm|ais|self_reported|unknown
    """
    eid = _safe_str(entity_id)
    eid_lower = eid.lower()

    if sp.has_radar_source():
        name = _fusion_source_name_from_radar(sp, eid)
        if not name:
            try:
                rs = sp.radar_source()
                name = _first_nonempty(
                    _call_str(rs.observation_context(), 'radar_name'),
                    _name_from_hardware_profile(rs.hardware_profile()),
                )
            except Exception as e:
                logger.debug(f"雷达画像回退名解析失败 entity_id={eid}: {e}")
        return (name or eid or '雷达', 'radar')

    if sp.has_eo_source():
        name = None
        try:
            eo = sp.eo_source()
            name = _first_nonempty(
                _name_from_hardware_profile(eo.hardware_profile()),
                _call_str(eo.target_profile(), 'classified_type'),
            )
        except Exception as e:
            logger.debug(f"光电画像解析失败 entity_id={eid}: {e}")
        return (name or eid or '光电', 'eo')

    if sp.has_esm_source():
        name = None
        try:
            es = sp.esm_source()
            tp = es.target_profile()
            name = _first_nonempty(
                _name_from_hardware_profile(es.hardware_profile()),
                _call_str(tp, 'emitter_identification'),
                _call_str(tp, 'emitter_type'),
            )
        except Exception as e:
            logger.debug(f"电侦画像解析失败 entity_id={eid}: {e}")
        return (name or eid or '电侦', 'esm')

    if sp.has_ais_source():
        name = None
        try:
            ap = sp.ais_target_profile()
            name = _first_nonempty(
                _call_str(ap, 'vessel_name'),
                _call_str(ap, 'mmsi'),
                _call_str(ap, 'call_sign'),
            )
        except Exception as e:
            logger.debug(f"AIS 画像解析失败 entity_id={eid}: {e}")
        if eid_lower == 'ais' and not name:
            name = 'AIS'
        return (name or eid or 'AIS', 'ais')

    if sp.has_self_reported_source():
        name = None
        try:
            sr = sp.self_reported_target_profile()
            name = _first_nonempty(
                _call_str(sr, 'device_name'),
                _call_str(sr, 'sn'),
                _call_str(sr, 'callsign'),
                _call_str(sr, 'source_system_name'),
            )
        except Exception as e:
            logger.debug(f"自报位画像解析失败 entity_id={eid}: {e}")
        return (name or eid or '自报位', 'self_reported')

    return (eid or None, 'unknown')


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
        ds_id = _safe_str(src.entity_id())
        tid_raw = src.source_track_id()
        sp = src.source_profile()
        name, source_type = _fusion_source_name_from_profile(sp, ds_id)
        if not name:
            name = 'AIS' if ds_id.lower() == 'ais' else ds_id
        out.append({
            'sourceName': name,
            'dataSourceId': ds_id,
            'external_target_id': int(tid_raw) if _safe_str(tid_raw).isdigit() else tid_raw,
            'sourceType': source_type,
        })
    return out


def _read_string_vector(values) -> List[str]:
    result: List[str] = []
    try:
        for i in range(len(values)):
            result.append(_safe_str(values[i]))
    except Exception:
        pass
    return result


def _geo_position_to_dict(pos: Any) -> Dict[str, Any]:
    if pos is None:
        return {}
    try:
        return {
            'longitude': float(pos.longitude()),
            'latitude': float(pos.latitude()),
            'altitude': float(pos.altitude()),
            'altitude_agl_m': float(pos.altitude_agl_m()),
            'altitude_afs_m': float(pos.altitude_afs_m()),
            'pressure_depth_m': float(pos.pressure_depth_m()),
            'is_2d': bool(pos.is_2d()),
            'altitude_ref': int(pos.altitude_ref()),
        }
    except Exception:
        return {}


def _measurement_to_dict(meas: Any) -> Dict[str, Any]:
    if meas is None:
        return {}
    try:
        return {
            'value': float(meas.value()),
            'sigma': float(meas.sigma()),
        }
    except Exception:
        return {}


def _entity_ref_to_dict(ref: Any) -> Dict[str, Any]:
    if ref is None:
        return {}
    return {
        'entity_type': _call_str(ref, 'entity_type'),
        'entity_id': _call_str(ref, 'entity_id'),
        'entity_name': _call_str(ref, 'entity_name'),
    }


def _alarm_area_to_dict(area: Any) -> Dict[str, Any]:
    if area is None:
        return {}
    return {
        'area_id': _call_str(area, 'area_id'),
        'area_name': _call_str(area, 'area_name'),
    }


def _detection_box_to_dict(box: Any) -> Dict[str, Any]:
    if box is None:
        return {}
    try:
        return {
            'camera_id': _call_str(box, 'camera_id'),
            'sync_header': int(box.sync_header()),
            'box_id': int(box.box_id()),
            'track_id': int(box.track_id()),
            'class_id': int(box.class_id()),
            'behavior_id': int(box.behavior_id()),
            'x': float(box.x()),
            'y': float(box.y()),
            'width': float(box.width()),
            'height': float(box.height()),
            'center_x': float(box.center_x()),
            'center_y': float(box.center_y()),
            'confidence': float(box.confidence()),
        }
    except Exception:
        return {}


def _alarm_spatial_info_to_dict(spatial: Any) -> Dict[str, Any]:
    if spatial is None:
        return {}
    try:
        return {
            'location_type': int(spatial.location_type()),
            'has_point_position': bool(spatial.has_point_position()),
            'point_position': _geo_position_to_dict(spatial.point_position()),
            'has_reference_position': bool(spatial.has_reference_position()),
            'reference_position': _geo_position_to_dict(spatial.reference_position()),
            'bearing_deg': float(spatial.bearing_deg()),
            'bearing_sigma_deg': float(spatial.bearing_sigma_deg()),
            'has_range_estimate': bool(spatial.has_range_estimate()),
            'range_estimate_m': _measurement_to_dict(spatial.range_estimate_m()),
            'has_range_min_m': bool(spatial.has_range_min_m()),
            'range_min_m': _measurement_to_dict(spatial.range_min_m()),
            'has_range_max_m': bool(spatial.has_range_max_m()),
            'range_max_m': _measurement_to_dict(spatial.range_max_m()),
            'sector_start_deg': float(spatial.sector_start_deg()),
            'sector_end_deg': float(spatial.sector_end_deg()),
            'spatial_confidence': float(spatial.spatial_confidence()),
            'source_sensor': _entity_ref_to_dict(spatial.source_sensor()),
        }
    except Exception:
        return {}


def _extract_alarms(obj) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if not hasattr(obj, 'alarms'):
        return out

    try:
        alarms = obj.alarms()
    except Exception:
        return out

    for i in range(len(alarms)):
        try:
            alarm = alarms[i]
            item = {
                'alarm_id': _call_str(alarm, 'alarm_id'),
                'categories': [int(alarm.categories()[j]) for j in range(len(alarm.categories()))],
                'status': int(alarm.status()),
                'disposition': int(alarm.disposition()),
                'content': _call_str(alarm, 'content'),
                'level': int(alarm.level()),
                'area': _alarm_area_to_dict(alarm.area()),
                'class_id': int(alarm.class_id()),
                'behavior_id': int(alarm.behavior_id()),
                'position': _geo_position_to_dict(alarm.position()),
                'spatial_info': _alarm_spatial_info_to_dict(alarm.spatial_info()),
                'raised_time': float(alarm.raised_time()),
                'updated_time': float(alarm.updated_time()),
                'resolved_time': float(alarm.resolved_time()),
                'resolved_by': _call_str(alarm, 'resolved_by'),
                'resolution_details': _call_str(alarm, 'resolution_details'),
                'rule_ids': _read_string_vector(alarm.rule_ids()),
                'has_detection_box': bool(alarm.has_detection_box()),
                'detection_box': _detection_box_to_dict(alarm.detection_box()),
            }
            out.append(item)
        except Exception as e:
            logger.debug(f"TargetObject alarms[{i}] 解析失败: {e}")
    return out


def target_object_to_track(obj) -> Dict[str, Any]:
    """单个 TargetObject → 前端航迹 dict；类型名仅由 trackType(classified_type) 决定。"""
    track_type = int(obj.classified_type())
    track_category_name = _TRACK_TYPE_TO_CATEGORY_NAME.get(track_type, 'unknown')

    kin = obj.target_kinematics()
    pos = kin.position()
    orient = kin.target_orientation()

    ts = float(obj.last_update_time())
    if ts <= 0:
        ts = float(obj.created_time())

    result: Dict[str, Any] = {
        'external_target_id': int(obj.external_target_id()) if _safe_str(obj.external_target_id()).isdigit() else obj.external_target_id(),
        'targetID': int(obj.target_id()) if _safe_str(obj.target_id()).isdigit() else obj.target_id(),
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
        'trackCategoryName': track_category_name,
        'trackAlias': str(obj.name()),
        'confidence': float(obj.type_confidence()),
        'reality_type': _read_reality_type(obj),
        'source': 'DDS',
        'data_type': 'fusion_track',
        'structure_type': 'new_track_struct',
    }

    # if(_read_reality_type(obj) == 2):
        # print("result:",result)

    fusion_sources = _extract_fusion_sources(obj)
    if fusion_sources:
        result['fusionSources'] = fusion_sources
        result['reserved6'] = json.dumps(fusion_sources, ensure_ascii=False)
        for fs in fusion_sources:
            if _safe_str(fs.get('dataSourceId')).lower() == 'ais':
                result['mmsi'] = fs.get('external_target_id')
                break

    alarms = _extract_alarms(obj)
    result['alarms'] = alarms
    result['alarmCount'] = len(alarms)
    result['hasAlarm'] = len(alarms) > 0
    result['alarm'] = alarms[0] if alarms else None
    if alarms:
        print(
            "alarms:",
            json.dumps(
                {
                    'external_target_id': result.get('external_target_id'),
                    'targetID': result.get('targetID'),
                    'alarmCount': len(alarms),
                    'alarmIds': [alarm.get('alarm_id') for alarm in alarms],
                },
                ensure_ascii=False,
            ),
        )

    return result


def parse_target_output_set(output_set) -> Optional[List[Dict[str, Any]]]:
    """TargetOutputSet → 航迹 dict 列表。"""
    targets = output_set.targets()
    return [target_object_to_track(targets[i]) for i in range(len(targets))]
