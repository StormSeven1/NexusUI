"""
gRPC TargetOutputSet (protobuf) → 前端航迹字典。

与 new_track_struct_parser（DDS FastDDS 绑定，字段为方法调用）对应；
本模块面向 protobuf 属性访问。每帧为多目标集合（stream 约 200ms）。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from loguru import logger

from parsers.new_track_struct_parser import (
    SUSPICIOUS_RULE_ID,
    _TRACK_TYPE_TO_CATEGORY_NAME,
    _fuse_type_from_environment,
    _is_suspicious_marker,
    _is_suspicious_only,
)

_STATE_NAMES = ("STABLE", "COASTING", "LOST", "MERGED", "SPLIT")


def _enum_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        if hasattr(value, "value") and not isinstance(value, (int, float, str)):
            return int(value.value)
        return int(value)
    except (TypeError, ValueError):
        return default


def _radar_external_track_id(sp) -> Optional[int]:
    if sp is None or not getattr(sp, "radar_source_present", False):
        return None
    try:
        tid = int(sp.radar_source.target_profile.track_id)
        return tid if tid > 0 else None
    except (TypeError, ValueError, AttributeError):
        return None


def _fusion_source_name_from_radar(sp, entity_id: str) -> Optional[str]:
    if sp is None or not getattr(sp, "radar_source_present", False):
        return None
    try:
        for fi in sp.radar_source.target_profile.fusionSources:
            if str(fi.dataSourceId) == str(entity_id):
                n = str(fi.sourceName or "").strip()
                return n or None
    except AttributeError:
        return None
    return None


def _extract_fusion_sources(obj) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for src in obj.sources:
        ds_id = str(src.entity_id or "").strip()
        tid_raw = src.source_track_id
        sp = src.source_profile
        name = _fusion_source_name_from_radar(sp, ds_id) if ds_id else None
        if not name:
            name = "AIS" if ds_id.lower() == "ais" else ds_id
        entry: Dict[str, Any] = {
            "sourceName": name,
            "dataSourceId": ds_id,
            "trackId": int(tid_raw) if str(tid_raw).strip().isdigit() else tid_raw,
        }
        ext_tid = _radar_external_track_id(sp)
        if ext_tid is not None:
            entry["externalTrackId"] = ext_tid
        out.append(entry)
    return out


def _target_alarm_item_to_ws(
    alarm,
    target_id: str,
    fuse_type: int,
    fallback_lat: float,
    fallback_lon: float,
) -> Optional[Dict[str, Any]]:
    alarm_id = str(getattr(alarm, "alarm_id", "") or "").strip()
    if not alarm_id:
        return None

    content = str(getattr(alarm, "content", "") or "").strip()
    disposition = _enum_int(getattr(alarm, "disposition", 0), 0)
    level = _enum_int(getattr(alarm, "level", 0), 0)
    updated_sec = float(getattr(alarm, "updated_time", 0) or getattr(alarm, "raised_time", 0) or 0.0)
    if updated_sec > 0:
        ts_ms = int(updated_sec * 1000.0)
        timestamp = datetime.fromtimestamp(updated_sec, tz=timezone.utc).isoformat()
    else:
        ts_ms = None
        timestamp = None

    area_name = ""
    area = getattr(alarm, "area", None)
    if area is not None:
        area_name = str(getattr(area, "area_name", "") or "").strip()

    lat, lon = fallback_lat, fallback_lon
    pos = getattr(alarm, "position", None)
    if pos is not None:
        try:
            lat = float(pos.latitude)
            lon = float(pos.longitude)
        except (TypeError, ValueError):
            pass

    rule_ids: List[str] = []
    for rid in getattr(alarm, "rule_ids", []) or []:
        s = str(rid or "").strip()
        if s:
            rule_ids.append(s)
    details = str(getattr(alarm, "resolution_details", "") or "").strip()
    suspicious = _is_suspicious_marker(rule_ids, content, alarm_id, details)

    severity = "info"
    if level >= 2:
        severity = "critical"
    elif level == 1:
        severity = "warning"

    item: Dict[str, Any] = {
        "alarmId": alarm_id,
        "trackId": target_id,
        "uniqueID": target_id,
        "targetId": target_id,
        "content": content,
        "taskStatus": disposition,
        "alarmLevel": level,
        "severity": severity,
        "message": "航迹告警",
        "fuseType": fuse_type,
        "fuse_type": fuse_type,
        "source": "NewTrackStruct",
    }
    if details:
        item["resolutionDetails"] = details
    if suspicious:
        # is_suspicious 挂在 alarm 上（与 TM 转发的 AlarmItem 对齐）
        item["is_suspicious"] = True
        item["isSuspicious"] = True
    if area_name:
        item["areaName"] = area_name
    if timestamp:
        item["timestamp"] = timestamp
        item["updateTime"] = timestamp
    if ts_ms is not None:
        item["lastUpdateTime"] = ts_ms
    if rule_ids:
        item["alarmRuleId"] = rule_ids
    if lat != 0.0 or lon != 0.0:
        item["position"] = {"latitude": lat, "longitude": lon}
        item["lat"] = lat
        item["lng"] = lon
    return item


def _extract_embedded_alarms(
    obj,
    target_id: str,
    fuse_type: int,
    fallback_lat: float,
    fallback_lon: float,
) -> tuple:
    """返回 (真实告警列表, 是否可疑标记)。可疑-only 不进告警中心。"""
    out: List[Dict[str, Any]] = []
    is_suspicious = False
    for alarm in getattr(obj, "alarms", []) or []:
        alarm_id = str(getattr(alarm, "alarm_id", "") or "").strip()
        content = str(getattr(alarm, "content", "") or "").strip()
        details = str(getattr(alarm, "resolution_details", "") or "").strip()
        rule_ids: List[str] = []
        for rid in getattr(alarm, "rule_ids", []) or []:
            s = str(rid or "").strip()
            if s:
                rule_ids.append(s)
        if _is_suspicious_marker(rule_ids, content, alarm_id, details):
            is_suspicious = True
        if _is_suspicious_only(rule_ids, content, alarm_id, details):
            continue
        parsed = _target_alarm_item_to_ws(
            alarm, target_id, fuse_type, fallback_lat, fallback_lon
        )
        if parsed:
            rules = parsed.get("alarmRuleId")
            if isinstance(rules, list):
                filtered = [r for r in rules if r != SUSPICIOUS_RULE_ID]
                if filtered:
                    parsed["alarmRuleId"] = filtered
                else:
                    parsed.pop("alarmRuleId", None)
            out.append(parsed)
    return out, is_suspicious


def _read_target_state(obj) -> Optional[str]:
    try:
        raw = obj.state
        if hasattr(raw, "name"):
            name = str(raw.name).replace("TargetState_", "").strip().upper()
            return name if name in _STATE_NAMES else None
        val = _enum_int(raw, -1)
        if 0 <= val < len(_STATE_NAMES):
            return _STATE_NAMES[val]
    except (TypeError, ValueError, AttributeError) as e:
        logger.debug(f"protobuf TargetObject.state 解析失败: {e}")
    return None


def _epoch_sec_to_ms(sec: Any) -> Optional[int]:
    """Unix epoch 秒（可带小数）→ 毫秒；无效返回 None。"""
    try:
        v = float(sec or 0.0)
    except (TypeError, ValueError):
        return None
    if v <= 0:
        return None
    return int(v * 1000.0)


def _grpc_send_time_sec_from_alternate_ids(obj) -> Optional[float]:
    """alternate_ids 中 type==grpc_send_time 的 id（epoch 秒）。"""
    for alt in getattr(obj, "alternate_ids", []) or []:
        if str(getattr(alt, "type", "") or "").strip() != "grpc_send_time":
            continue
        try:
            v = float(getattr(alt, "id", "") or 0.0)
            return v if v > 0 else None
        except (TypeError, ValueError):
            return None
    return None


def _attach_link_times_new_track(result: Dict[str, Any], obj) -> None:
    """
    临时约定（不改 proto）：
    - created_time = UDP 包头时间 → track_created_time_ms（航迹创建）
    - last_update_time = 本机接收时间 → track_source_recv_time_ms（航迹接收）
    - alternate_ids[grpc_send_time] = gRPC 发送时间 → track_grpc_send_time_ms（航迹发送）
    """
    created_ms = _epoch_sec_to_ms(getattr(obj, "created_time", 0.0))
    source_recv_ms = _epoch_sec_to_ms(getattr(obj, "last_update_time", 0.0))
    send_ms = _epoch_sec_to_ms(_grpc_send_time_sec_from_alternate_ids(obj))
    if created_ms is not None:
        result["track_created_time_ms"] = created_ms
    if source_recv_ms is not None:
        result["track_source_recv_time_ms"] = source_recv_ms
    if send_ms is not None:
        result["track_grpc_send_time_ms"] = send_ms


def target_object_to_track_pb(obj) -> Dict[str, Any]:
    """单个 protobuf TargetObject → 前端航迹 dict。"""
    track_type = _enum_int(obj.classified_type)
    track_category_name = _TRACK_TYPE_TO_CATEGORY_NAME.get(track_type, "unknown")

    target_id = str(obj.target_id or "").strip()
    ext_id = str(obj.external_target_id or "").strip()
    track_id_raw = ext_id if ext_id else target_id

    kin = obj.target_kinematics
    pos = kin.position
    orient = kin.target_orientation

    # lastUpdate/timestamp：优先 UDP 包头（created_time）；缺省再回退本机接收
    created_sec = float(obj.created_time or 0.0)
    source_recv_sec = float(obj.last_update_time or 0.0)
    ts = created_sec if created_sec > 0 else source_recv_sec

    reality_type = _enum_int(obj.reality_type, 0)
    target_state = _read_target_state(obj)
    environment = _enum_int(obj.environment, 0)
    fuse_type = _fuse_type_from_environment(environment)

    result: Dict[str, Any] = {
        "trackId": int(track_id_raw) if track_id_raw.isdigit() else track_id_raw,
        "uniqueId": int(target_id) if target_id.isdigit() else target_id,
        "targetId": int(target_id) if target_id.isdigit() else target_id,
        "longitude": float(pos.longitude),
        "latitude": float(pos.latitude),
        "height": float(pos.altitude),
        "altitude": float(pos.altitude),
        "course": float(orient.yaw),
        "pitch": float(orient.pitch),
        "roll": float(orient.roll),
        "speed": float(kin.speed),
        "azimuth": float(obj.fused_azimuth_deg),
        "elevation": float(obj.fused_elevation_deg),
        "range": float(obj.fused_range_m),
        "timestamp": ts,
        "trackType": track_type,
        "classified_type": track_type,
        "trackCategoryName": track_category_name,
        "trackAlias": str(obj.name or ""),
        "confidence": float(obj.type_confidence or 0.0),
        "reality_type": reality_type,
        "environment": environment,
        "fuseType": fuse_type,
        "source": "gRPC",
        "data_type": "fusion_track",
        "structure_type": "new_track_struct",
    }
    _attach_link_times_new_track(result, obj)
    if target_state:
        result["targetState"] = target_state
    if ext_id:
        result["externalTargetId"] = int(ext_id) if ext_id.isdigit() else ext_id
    if reality_type == 2:
        result["is_virtual"] = True
        result["virtualTroop"] = True
    if track_type == 1:
        result["is_uav"] = True
        result["isUav"] = True

    fusion_sources = _extract_fusion_sources(obj)
    if fusion_sources:
        result["fusionSources"] = fusion_sources
        result["reserved6"] = json.dumps(fusion_sources, ensure_ascii=False)
        for fs in fusion_sources:
            if str(fs.get("dataSourceId", "")).lower() == "ais":
                result["mmsi"] = fs.get("trackId")
                break

    embedded_alarms, is_suspicious = _extract_embedded_alarms(
        obj,
        target_id,
        fuse_type,
        float(pos.latitude),
        float(pos.longitude),
    )
    if embedded_alarms:
        result["embedded_alarms"] = embedded_alarms
    if is_suspicious:
        result["is_suspicious"] = True
        result["isSuspicious"] = True

    return result


def parse_target_output_set_pb(output_set) -> Optional[List[Dict[str, Any]]]:
    """protobuf TargetOutputSet → 航迹 dict 列表。"""
    if output_set is None:
        return None
    targets = list(getattr(output_set, "targets", []) or [])
    if not targets:
        return []
    return [target_object_to_track_pb(t) for t in targets]
