"""
TargetOutputSet (NewTrackStruct) → 前端航迹字典。

IDL TargetObject:
  - target_kinematics: 位置 / target_orientation / speed
  - fused_azimuth_deg / fused_elevation_deg / fused_range_m: 相对融合中心极坐标
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
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


def _radar_external_track_id_from_source_profile(sp) -> Optional[int]:
    """RadarObservedTargetProfile.track_id → 雷达 external_target_id（非融合 source_track_id）。"""
    if not sp or not sp.has_radar_source():
        return None
    try:
        rtp = sp.radar_source().target_profile()
        tid = rtp.track_id()
        if tid is None:
            return None
        n = int(tid)
        return n if n > 0 else None
    except (TypeError, ValueError, AttributeError):
        return None


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


def _read_enum_int(getter, default: int = 0) -> int:
    try:
        raw = getter()
        if hasattr(raw, 'value'):
            return int(raw.value)
        return int(raw)
    except (TypeError, ValueError):
        return default


def _fuse_type_from_environment(env: int) -> int:
    """EnvironmentType.AIR(2) → 对空 fuseType=1，其余默认对海 0。"""
    return 1 if env == 2 else 0


SUSPICIOUS_RULE_ID = "suspicious_target"


def _alarm_rule_ids(alarm) -> List[str]:
    rule_ids: List[str] = []
    if hasattr(alarm, 'rule_ids'):
        try:
            rules = alarm.rule_ids()
        except TypeError:
            rules = getattr(alarm, 'rule_ids', None) or []
            if callable(rules):
                rules = rules()
        for i in range(len(rules)):
            rid = str(rules[i] or '').strip()
            if rid:
                rule_ids.append(rid)
    return rule_ids


def _alarm_resolution_details(alarm) -> str:
    raw = ""
    if hasattr(alarm, "resolution_details"):
        try:
            raw = alarm.resolution_details()
        except TypeError:
            raw = getattr(alarm, "resolution_details", "") or ""
            if callable(raw):
                raw = raw()
    return str(raw or "").strip()


def _is_suspicious_marker(
    rule_ids: List[str],
    content: str = "",
    alarm_id: str = "",
    resolution_details: str = "",
) -> bool:
    """可疑标记只认 AlarmItem 内字段（TM 原样转发），不认目标外层自定义字段。"""
    details = (resolution_details or "").strip().lower()
    if details == "is_suspicious" or "is_suspicious" in details:
        return True
    if any(r == SUSPICIOUS_RULE_ID for r in rule_ids):
        return True
    if content.strip() == "SuspiciousTarget":
        return True
    return alarm_id.startswith("suspicious_")


def _is_suspicious_only(
    rule_ids: List[str],
    content: str = "",
    alarm_id: str = "",
    resolution_details: str = "",
) -> bool:
    """纯可疑标记（无其它规则）→ 不进告警中心。"""
    if not _is_suspicious_marker(rule_ids, content, alarm_id, resolution_details):
        return False
    other = [r for r in rule_ids if r != SUSPICIOUS_RULE_ID]
    if other:
        return False
    # 有真实告警 content 但仅叠加 is_suspicious 时，不算 only
    if content.strip() and content.strip() != "SuspiciousTarget" and not alarm_id.startswith("suspicious_"):
        return False
    return True


def _target_alarm_item_to_ws(
    alarm,
    target_id: str,
    fuse_type: int,
    fallback_lat: float,
    fallback_lon: float,
) -> Optional[Dict[str, Any]]:
    if not hasattr(alarm, 'alarm_id'):
        return None
    alarm_id = str(alarm.alarm_id() or '').strip()
    if not alarm_id:
        return None

    content = str(alarm.content() or '').strip()
    disposition = _read_enum_int(alarm.disposition, 0)
    level = _read_enum_int(alarm.level, 0)
    updated_sec = float(alarm.updated_time() or alarm.raised_time() or 0.0)
    if updated_sec > 0:
        ts_ms = int(updated_sec * 1000.0)
        timestamp = datetime.fromtimestamp(updated_sec, tz=timezone.utc).isoformat()
    else:
        ts_ms = None
        timestamp = None

    area_name = ''
    if hasattr(alarm, 'area'):
        area = alarm.area()
        if area is not None and hasattr(area, 'area_name'):
            area_name = str(area.area_name() or '').strip()

    lat = fallback_lat
    lon = fallback_lon
    if hasattr(alarm, 'position'):
        pos = alarm.position()
        if pos is not None:
            try:
                lat = float(pos.latitude())
                lon = float(pos.longitude())
            except (TypeError, ValueError):
                pass

    rule_ids = _alarm_rule_ids(alarm)
    details = _alarm_resolution_details(alarm)
    suspicious = _is_suspicious_marker(rule_ids, content, alarm_id, details)

    # ThreatLevel: 0=LOW / 1=MEDIUM / 2=HIGH → 前端 severity
    severity = "info"
    if level >= 2:
        severity = "critical"
    elif level == 1:
        severity = "warning"

    item: Dict[str, Any] = {
        'alarmId': alarm_id,
        'trackId': target_id,
        'uniqueID': target_id,
        'targetId': target_id,
        'content': content,
        'taskStatus': disposition,
        # 枚举等级；勿把 threatScore 填成 0/1/2（会与 AlarmEvent 的 0~100 威胁分混淆）
        'alarmLevel': level,
        'severity': severity,
        'message': '航迹告警',
        'fuseType': fuse_type,
        'fuse_type': fuse_type,
        'source': 'NewTrackStruct',
    }
    if details:
        item['resolutionDetails'] = details
    if suspicious:
        # is_suspicious 挂在 alarm 上（与 TM 转发的 AlarmItem 对齐），不依赖目标外层字段
        item['is_suspicious'] = True
        item['isSuspicious'] = True
    if area_name:
        item['areaName'] = area_name
    if timestamp:
        item['timestamp'] = timestamp
        item['updateTime'] = timestamp
    if ts_ms is not None:
        item['lastUpdateTime'] = ts_ms
    if rule_ids:
        item['alarmRuleId'] = rule_ids
    if lat != 0.0 or lon != 0.0:
        item['position'] = {'latitude': lat, 'longitude': lon}
        item['lat'] = lat
        item['lng'] = lon
    return item


def _extract_embedded_alarms(
    obj,
    target_id: str,
    fuse_type: int,
    fallback_lat: float,
    fallback_lon: float,
) -> tuple:
    """返回 (真实告警列表, 是否可疑标记)。可疑-only 不进告警中心。"""
    if not hasattr(obj, 'alarms'):
        return [], False
    try:
        alarm_seq = obj.alarms()
    except (TypeError, AttributeError):
        return [], False
    out: List[Dict[str, Any]] = []
    is_suspicious = False
    for i in range(len(alarm_seq)):
        alarm = alarm_seq[i]
        try:
            alarm_id = str(alarm.alarm_id() or '').strip()
            content = str(alarm.content() or '').strip()
        except (TypeError, AttributeError):
            alarm_id = str(getattr(alarm, 'alarm_id', '') or '').strip()
            content = str(getattr(alarm, 'content', '') or '').strip()
        rule_ids = _alarm_rule_ids(alarm)
        details = _alarm_resolution_details(alarm)
        if _is_suspicious_marker(rule_ids, content, alarm_id, details):
            is_suspicious = True
        if _is_suspicious_only(rule_ids, content, alarm_id, details):
            continue
        parsed = _target_alarm_item_to_ws(
            alarm, target_id, fuse_type, fallback_lat, fallback_lon)
        if parsed:
            # 真实告警上若带可疑 rule，去掉以免污染告警中心展示
            rules = parsed.get('alarmRuleId')
            if isinstance(rules, list):
                filtered = [r for r in rules if r != SUSPICIOUS_RULE_ID]
                if filtered:
                    parsed['alarmRuleId'] = filtered
                else:
                    parsed.pop('alarmRuleId', None)
            out.append(parsed)
    return out, is_suspicious


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
        entry: Dict[str, Any] = {
            'sourceName': name,
            'dataSourceId': ds_id,
            'trackId': int(tid_raw) if str(tid_raw).strip().isdigit() else tid_raw,
        }
        ext_tid = _radar_external_track_id_from_source_profile(sp)
        if ext_tid is not None:
            entry['externalTrackId'] = ext_tid
        out.append(entry)
    return out


def _read_target_state(obj) -> Optional[str]:
    """TargetObject.state → STABLE / COASTING / LOST / MERGED / SPLIT。"""
    if not hasattr(obj, 'state'):
        return None
    names = ('STABLE', 'COASTING', 'LOST', 'MERGED', 'SPLIT')
    try:
        raw = obj.state()
        if hasattr(raw, 'name'):
            name = str(raw.name).strip().upper()
            return name if name in names else None
        val = int(raw.value) if hasattr(raw, 'value') else int(raw)
        if 0 <= val < len(names):
            return names[val]
    except (TypeError, ValueError, AttributeError) as e:
        logger.debug(f"TargetObject.state 解析失败: {e}")
    return None


def target_object_to_track(obj) -> Dict[str, Any]:
    """单个 TargetObject → 前端航迹 dict；类型名仅由 trackType(classified_type) 决定。"""
    track_type = _read_enum_int(obj.classified_type)
    track_category_name = _TRACK_TYPE_TO_CATEGORY_NAME.get(track_type, 'unknown')

    target_id = str(obj.target_id()).strip()
    ext_id = str(obj.external_target_id()).strip()
    # trackId：业务 track_id（external_target_id），无人机管理软件等 legacy 系统使用
    track_id_raw = ext_id if ext_id else target_id

    kin = obj.target_kinematics()
    pos = kin.position()
    orient = kin.target_orientation()

    ts = float(obj.last_update_time())
    if ts <= 0:
        ts = float(obj.created_time())

    reality_type = _read_reality_type(obj)
    target_state = _read_target_state(obj)
    environment = _read_enum_int(obj.environment, 0)
    fuse_type = _fuse_type_from_environment(environment)

    result: Dict[str, Any] = {
        'trackId': int(track_id_raw) if track_id_raw.isdigit() else track_id_raw,
        'uniqueId': int(target_id) if target_id.isdigit() else target_id,
        'targetId': int(target_id) if target_id.isdigit() else target_id,
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
    if target_state:
        result['targetState'] = target_state
    if ext_id:
        result['externalTargetId'] = int(ext_id) if ext_id.isdigit() else ext_id
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

    embedded_alarms, is_suspicious = _extract_embedded_alarms(
        obj,
        target_id,
        fuse_type,
        float(pos.latitude()),
        float(pos.longitude()),
    )
    if embedded_alarms:
        result['embedded_alarms'] = embedded_alarms
    if is_suspicious:
        result['is_suspicious'] = True
        result['isSuspicious'] = True

    return result


def parse_target_output_set(output_set) -> Optional[List[Dict[str, Any]]]:
    """TargetOutputSet → 航迹 dict 列表。"""
    targets = output_set.targets()
    return [target_object_to_track(targets[i]) for i in range(len(targets))]


def parse_suspicious_target_set(output_set) -> Optional[Dict[str, Any]]:
    """TargetOutputSet（NewTrackStructSuspicious）→ 可疑 unique_id 列表，不写航迹 store。"""
    target_ids: List[str] = []
    targets = output_set.targets()
    for i in range(len(targets)):
        tid = str(targets[i].target_id() or "").strip()
        if tid:
            target_ids.append(tid)
    return {
        "data_type": "suspicious_target",
        "target_ids": target_ids,
        "count": len(target_ids),
    }
