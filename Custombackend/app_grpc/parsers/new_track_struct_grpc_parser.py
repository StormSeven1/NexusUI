"""Parse protobuf TargetOutputSet from NewTrackStruct gRPC into frontend track dicts."""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger


_TRACK_TYPE_TO_CATEGORY_NAME: Dict[int, str] = {
    0: "unknown",
    1: "uav",
    2: "bird",
    3: "helicopter",
    4: "aircraft",
    5: "missile",
    6: "buoy",
    7: "ship",
    8: "submarine",
    9: "ground_vehicle",
    10: "person",
    11: "animal",
    12: "other",
}

_FRIEND_FOE_TO_DISPOSITION: Dict[int, str] = {
    0: "friendly",  # FRIEND
    1: "hostile",   # FOE
    2: "own",       # OWN
    3: "neutral",   # NEUTRAL
    4: "unknown",   # UNKNOWN
}


def _safe_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _to_int(value: Any) -> Any:
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


def _numeric_string(value: Any) -> Any:
    text = _safe_str(value)
    return int(text) if text.isdigit() else value


def _friend_foe_to_disposition(value: Any) -> Optional[str]:
    try:
        return _FRIEND_FOE_TO_DISPOSITION.get(int(value))
    except (TypeError, ValueError):
        return None


def _first_nonempty(*values: Any) -> Optional[str]:
    for value in values:
        text = _safe_str(value)
        if text:
            return text
    return None


def _name_from_hardware_profile(hw: Any) -> Optional[str]:
    return _first_nonempty(
        getattr(hw, "deployment_site_name", ""),
        getattr(hw, "sensor_model", ""),
        getattr(hw, "profile_id", ""),
    )


def _fusion_source_name_from_radar(sp: Any, entity_id: str) -> Optional[str]:
    if not getattr(sp, "radar_source_present", False):
        return None
    try:
        rtp = sp.radar_source.target_profile
        for item in rtp.fusionSources:
            if _safe_str(item.dataSourceId) == _safe_str(entity_id):
                name = _safe_str(item.sourceName)
                if name:
                    return name
        return _first_nonempty(rtp.trackAlias, rtp.description)
    except Exception as exc:
        logger.debug(f"gRPC radar fusionSources parse failed entity_id={entity_id}: {exc}")
        return None


def _fusion_source_name_from_profile(sp: Any, entity_id: str) -> Tuple[Optional[str], str]:
    eid = _safe_str(entity_id)
    eid_lower = eid.lower()

    if getattr(sp, "radar_source_present", False):
        name = _fusion_source_name_from_radar(sp, eid)
        if not name:
            rs = sp.radar_source
            name = _first_nonempty(
                getattr(rs.observation_context, "radar_name", ""),
                _name_from_hardware_profile(rs.hardware_profile),
            )
        return (name or eid or "雷达", "radar")

    if getattr(sp, "eo_source_present", False):
        eo = sp.eo_source
        name = _first_nonempty(
            _name_from_hardware_profile(eo.hardware_profile),
            getattr(eo.target_profile, "classified_type", ""),
        )
        return (name or eid or "光电", "eo")

    if getattr(sp, "esm_source_present", False):
        es = sp.esm_source
        tp = es.target_profile
        name = _first_nonempty(
            _name_from_hardware_profile(es.hardware_profile),
            getattr(tp, "emitter_identification", ""),
            getattr(tp, "emitter_type", ""),
        )
        return (name or eid or "电侦", "esm")

    if getattr(sp, "ais_source_present", False):
        ap = sp.ais_target_profile
        name = _first_nonempty(ap.vessel_name, ap.mmsi, ap.call_sign)
        if eid_lower == "ais" and not name:
            name = "AIS"
        return (name or eid or "AIS", "ais")

    if getattr(sp, "self_reported_source_present", False):
        sr = sp.self_reported_target_profile
        name = _first_nonempty(
            sr.device_name,
            sr.sn,
            sr.callsign,
            sr.source_system_name,
        )
        return (name or eid or "自报位", "self_reported")

    return (eid or None, "unknown")


def _geo_position_to_dict(pos: Any) -> Dict[str, Any]:
    return {
        "longitude": float(pos.longitude),
        "latitude": float(pos.latitude),
        "altitude": float(pos.altitude),
        "altitude_agl_m": float(pos.altitude_agl_m),
        "altitude_afs_m": float(pos.altitude_afs_m),
        "pressure_depth_m": float(pos.pressure_depth_m),
        "is_2d": bool(pos.is_2d),
        "altitude_ref": int(pos.altitude_ref),
    }


def _measurement_to_dict(meas: Any) -> Dict[str, Any]:
    return {"value": float(meas.value), "sigma": float(meas.sigma)}


def _entity_ref_to_dict(ref: Any) -> Dict[str, Any]:
    return {
        "entity_type": _safe_str(ref.entity_type),
        "entity_id": _safe_str(ref.entity_id),
        "entity_name": _safe_str(ref.entity_name),
    }


def _detection_box_to_dict(box: Any) -> Dict[str, Any]:
    return {
        "camera_id": _safe_str(box.camera_id),
        "sync_header": int(box.sync_header),
        "box_id": int(box.box_id),
        "track_id": int(box.track_id),
        "class_id": int(box.class_id),
        "behavior_id": int(box.behavior_id),
        "x": float(box.x),
        "y": float(box.y),
        "width": float(box.width),
        "height": float(box.height),
        "center_x": float(box.center_x),
        "center_y": float(box.center_y),
        "confidence": float(box.confidence),
    }


def _alarm_spatial_info_to_dict(spatial: Any) -> Dict[str, Any]:
    return {
        "location_type": int(spatial.location_type),
        "has_point_position": bool(spatial.point_position_present),
        "point_position": _geo_position_to_dict(spatial.point_position),
        "has_reference_position": bool(spatial.reference_position_present),
        "reference_position": _geo_position_to_dict(spatial.reference_position),
        "bearing_deg": float(spatial.bearing_deg),
        "bearing_sigma_deg": float(spatial.bearing_sigma_deg),
        "has_range_estimate": bool(spatial.range_estimate_present),
        "range_estimate_m": _measurement_to_dict(spatial.range_estimate_m),
        "has_range_min_m": bool(spatial.range_min_present),
        "range_min_m": _measurement_to_dict(spatial.range_min_m),
        "has_range_max_m": bool(spatial.range_max_present),
        "range_max_m": _measurement_to_dict(spatial.range_max_m),
        "sector_start_deg": float(spatial.sector_start_deg),
        "sector_end_deg": float(spatial.sector_end_deg),
        "spatial_confidence": float(spatial.spatial_confidence),
        "source_sensor": _entity_ref_to_dict(spatial.source_sensor),
    }


def _extract_alarms(target: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for alarm in target.alarms:
        try:
            out.append(
                {
                    "alarm_id": _safe_str(alarm.alarm_id),
                    "categories": [int(item) for item in alarm.categories],
                    "status": int(alarm.status),
                    "disposition": int(alarm.disposition),
                    "content": _safe_str(alarm.content),
                    "level": int(alarm.level),
                    "area": {
                        "area_id": _safe_str(alarm.area.area_id),
                        "area_name": _safe_str(alarm.area.area_name),
                    },
                    "class_id": int(alarm.class_id),
                    "behavior_id": int(alarm.behavior_id),
                    "position": _geo_position_to_dict(alarm.position),
                    "spatial_info": _alarm_spatial_info_to_dict(alarm.spatial_info),
                    "raised_time": float(alarm.raised_time),
                    "updated_time": float(alarm.updated_time),
                    "resolved_time": float(alarm.resolved_time),
                    "resolved_by": _safe_str(alarm.resolved_by),
                    "resolution_details": _safe_str(alarm.resolution_details),
                    "rule_ids": [_safe_str(item) for item in alarm.rule_ids],
                    "has_detection_box": bool(alarm.detection_box_present),
                    "detection_box": _detection_box_to_dict(alarm.detection_box),
                }
            )
        except Exception as exc:
            logger.debug(f"gRPC TargetObject alarm parse failed: {exc}")
    return out


def _extract_fusion_sources(target: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for source in target.sources:
        ds_id = _safe_str(source.entity_id)
        track_id = source.source_track_id
        name, source_type = _fusion_source_name_from_profile(source.source_profile, ds_id)
        if not name:
            name = "AIS" if ds_id.lower() == "ais" else ds_id
        out.append(
            {
                "sourceName": name,
                "dataSourceId": ds_id,
                "external_target_id": _numeric_string(track_id),
                "sourceType": source_type,
            }
        )
    return out


def target_object_to_track(target: Any) -> Dict[str, Any]:
    track_type = int(target.classified_type)
    friend_foe = _to_int(getattr(target, "friend_foe", None))
    kin = target.target_kinematics
    pos = kin.position
    orient = kin.target_orientation
    ts = float(target.last_update_time) or float(target.created_time)

    result: Dict[str, Any] = {
        "external_target_id": _numeric_string(target.external_target_id),
        "targetID": _numeric_string(target.target_id),
        "longitude": float(pos.longitude),
        "latitude": float(pos.latitude),
        "height": float(pos.altitude),
        "altitude": float(pos.altitude),
        "course": float(orient.yaw),
        "pitch": float(orient.pitch),
        "roll": float(orient.roll),
        "speed": float(kin.speed),
        "azimuth": float(target.fused_azimuth_deg),
        "elevation": float(target.fused_elevation_deg),
        "range": float(target.fused_range_m),
        "timestamp": ts,
        "trackType": track_type,
        "trackCategoryName": _TRACK_TYPE_TO_CATEGORY_NAME.get(track_type, "unknown"),
        "targetState": int(target.state),
        "targetDescription": _safe_str(target.description),
        "trackAlias": _safe_str(target.name),
        "confidence": float(target.type_confidence),
        "friend_foe": friend_foe,
        "friendFoe": friend_foe,
        "friendFoeType": friend_foe,
        "disposition": _friend_foe_to_disposition(friend_foe),
        "reality_type": int(target.reality_type),
        "environment": int(target.environment),
        "source": "gRPC",
        "data_type": "fusion_track",
        "structure_type": "new_track_struct",
    }

    fusion_sources = _extract_fusion_sources(target)
    if fusion_sources:
        result["fusionSources"] = fusion_sources
        result["reserved6"] = json.dumps(fusion_sources, ensure_ascii=False)
        for item in fusion_sources:
            if _safe_str(item.get("dataSourceId")).lower() == "ais":
                result["mmsi"] = item.get("external_target_id")
                break

    alarms = _extract_alarms(target)
    result["alarms"] = alarms
    result["alarmCount"] = len(alarms)
    result["hasAlarm"] = len(alarms) > 0
    result["alarm"] = alarms[0] if alarms else None
    return result


def parse_target_output_set(output_set: Any) -> List[Dict[str, Any]]:
    return [target_object_to_track(target) for target in output_set.targets]
