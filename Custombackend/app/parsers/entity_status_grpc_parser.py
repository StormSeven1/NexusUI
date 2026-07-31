"""EntityStatus gRPC → 与 DDS 无人机解析器一致的 WS 载荷。"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from google.protobuf.json_format import MessageToDict
from loguru import logger

from config import get_settings

# 与 dds_parser._parse_drone_status 保持一致：这些 mode_code 不推前端
_FILTERED_DRONE_MODE_CODES = {
    0: "STANDBY",
    1: "TAKEOFF_PREPARING",
    2: "TAKEOFF_READY",
    4: "AUTO_TAKEOFF",
    14: "DISCONNECTED",
}


def _maybe_store_drone_log(filename_prefix: str, payload: Dict[str, Any]) -> None:
    if not get_settings().ENABLE_DRONE_DATA_STORAGE:
        return
    try:
        row = {**payload, "timestamp": datetime.now().isoformat()}
        storage_dir = os.path.join(os.path.dirname(__file__), "..", "data", "drone_logs")
        os.makedirs(storage_dir, exist_ok=True)
        date_str = datetime.now().strftime("%Y-%m-%d")
        filepath = os.path.join(storage_dir, f"{filename_prefix}_{date_str}.jsonl")
        with open(filepath, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception as e:
        logger.error(f"存储无人机 gRPC 数据失败: {e}")


def _base_fields(base_msg) -> Dict[str, Any]:
    if base_msg is None:
        return {}
    return {
        "entityId": base_msg.entity_id or None,
        "entity_id": base_msg.entity_id or None,
        "entityType": int(base_msg.entity_type),
        "disposition_type": int(base_msg.disposition_type),
        "online": bool(base_msg.online),
        "taskType": base_msg.task_type or None,
        "executionState": int(base_msg.execution_state),
        "executionTimeMs": int(base_msg.execution_time_ms),
        "deviceState": int(base_msg.device_state),
    }


def _parse_waypoints(wayline_msg) -> List[Dict[str, Any]]:
    if wayline_msg is None:
        return []
    waypoints: List[Dict[str, Any]] = []
    for wp in wayline_msg.way_point_list:
        waypoints.append(
            {
                "index": int(wp.index),
                "latitude": float(wp.latitude),
                "longitude": float(wp.longitude),
                "height": float(wp.height),
                "speed": float(wp.speed),
            }
        )
    return waypoints


def parse_entity_status_response(resp, *, source_id: str) -> Optional[Dict[str, Any]]:
    """解析 EntityStatusResponse oneof，返回带 data_type 的字典（与 DDS 解析器对齐）。"""
    which = resp.WhichOneof("status")
    if not which:
        return None

    try:
        if which == "camera_real_time_status":
            return _parse_camera_real_time_status(resp.camera_real_time_status, source_id=source_id)
        if which == "drone_real_time_status":
            return _parse_drone_real_time_status(resp.drone_real_time_status, source_id=source_id)
        if which == "drone_task_real_time_status":
            return _parse_drone_task_real_time_status(resp.drone_task_real_time_status, source_id=source_id)
        if which == "high_freq_real_time_status":
            return _parse_high_freq_real_time_status(resp.high_freq_real_time_status, source_id=source_id)
    except Exception as e:
        logger.error(f"解析 EntityStatus gRPC [{source_id}] {which} 失败: {e}")
    return None


def _parse_camera_real_time_status(msg, *, source_id: str) -> Optional[Dict[str, Any]]:
    """解析 CameraRealTimeStatus gRPC → 与 dds_parser._parse_camera_status 输出结构完全对齐。"""
    base = msg.base
    entity_id = (base.entity_id if base else "").strip() or None
    if not entity_id:
        return None

    result: Dict[str, Any] = {
        # 基础字段（对齐 DDS camera_status）
        "entityId": entity_id,
        "taskType": base.task_type or None,
        "executionState": int(base.execution_state),
        "executionTimeMs": int(base.execution_time_ms),
        "online": bool(base.online),
        "elec": float(base.elec) if base.elec else None,
        "timestamp": base.timestamp or None,
        "entityType": int(base.entity_type),
        "dispositionType": int(base.disposition_type),
        "targetID": int(base.target_id) if base.target_id else None,
        "targetName": base.target_name or None,
        "targetType": int(base.target_type),
        "deviceState": int(base.device_state),
        # 相机专属
        "focus": float(msg.focus) if msg.focus else None,
        "panoOffset": float(msg.pano_offset) if msg.pano_offset else None,
        "trackID": int(msg.track_id) if msg.track_id else None,
        "trackAlias": None,          # gRPC proto 暂无此字段
        "visibility": float(msg.visibility) if msg.visibility else None,
        "rootPos": float(msg.root_pos) if msg.root_pos else None,
        "speedParam": float(msg.speed_param) if msg.speed_param else None,
        # PTZ（与 DDS 一致：pan/tilt/zoom 子字典）
        "ptz": {
            "pan": float(msg.ptz.pan),
            "tilt": float(msg.ptz.tilt),
            "zoom": float(msg.ptz.zoom),
        },
        "originPtz": {
            "pan": float(msg.origin_ptz.pan),
            "tilt": float(msg.origin_ptz.tilt),
            "zoom": float(msg.origin_ptz.zoom),
        },
        # FOV（gRPC 用 horizontal/vertical；store 里 fovHsDeg/fovVsDeg 也读这两个键）
        "fov": {
            "horizontal": float(msg.fov.horizontal),
            "vertical": float(msg.fov.vertical),
        },
        "source": "gRPC",
        "grpc_source_id": source_id,
        "data_type": "camera_status",
    }
    return result


def _parse_drone_real_time_status(msg, *, source_id: str) -> Optional[Dict[str, Any]]:
    mode_code = int(msg.mode_code)
    # gRPC 侧蓝方等可能长期上报 mode_code=0 但仍带有效坐标，仅过滤明确断连态
    if mode_code == 14:
        return None

    base = _base_fields(msg.base if msg.base.entity_id or msg.base.entity_type else None)
    drone_sn = (msg.drone_sn or base.get("entityId") or "").strip() or None

    result: Dict[str, Any] = {
        **base,
        "drone_sn": drone_sn,
        "deviceSn": drone_sn,
        "track_id": msg.track_id or None,
        "latitude": float(msg.latitude),
        "longitude": float(msg.longitude),
        "height": float(msg.height),
        "attitude_head": int(msg.attitude_head),
        "attitude_pitch": float(msg.attitude_pitch),
        "attitude_roll": float(msg.attitude_roll),
        "horizontal_speed": float(msg.horizontal_speed),
        "vertical_speed": float(msg.vertical_speed),
        "mode_code": mode_code,
        "source": "gRPC",
        "grpc_source_id": source_id,
        "data_type": "drone_status",
    }

    if msg.type_subtype_gimbalindex.payload_index:
        gimbal = msg.type_subtype_gimbalindex
        result["gimbal_pitch"] = float(gimbal.gimbal_pitch)
        result["gimbal_roll"] = float(gimbal.gimbal_roll)
        result["gimbal_yaw"] = float(gimbal.gimbal_yaw)

    if msg.battery.capacity_percent or msg.battery.batteries:
        result["battery_percent"] = int(msg.battery.capacity_percent)

    _maybe_store_drone_log("drone_status", result)
    return result


def _parse_drone_task_real_time_status(msg, *, source_id: str) -> Optional[Dict[str, Any]]:
    base = _base_fields(msg.base if msg.base.entity_id or msg.base.entity_type else None)
    wayline = msg.current_wayline if msg.current_wayline.wayline_id or msg.current_wayline.way_point_list else None

    result: Dict[str, Any] = {
        **base,
        "drone_state": msg.drone_state or None,
        "drone_task_action": msg.drone_task_action or None,
        "drone_task_targetID": msg.drone_task_target_id or None,
        "waypoints": _parse_waypoints(wayline),
        "wayline_id": wayline.wayline_id if wayline else None,
        "wayline_name": wayline.wayline_name if wayline else None,
        "source": "gRPC",
        "grpc_source_id": source_id,
        "data_type": "drone_task",
    }

    if base.get("entityId"):
        result["entityId"] = base["entityId"]
        result["entity_id"] = base["entityId"]

    _maybe_store_drone_log("drone_task", result)
    return result


def _parse_high_freq_real_time_status(msg, *, source_id: str) -> Optional[Dict[str, Any]]:
    base = _base_fields(msg.base if msg.base.entity_id or msg.base.entity_type else None)
    drone_sn = (msg.drone_sn or base.get("entityId") or "").strip() or None

    result: Dict[str, Any] = {
        **base,
        "drone_sn": drone_sn,
        "deviceSn": drone_sn,
        "dock_sn": msg.dock_sn or None,
        "latitude": float(msg.latitude),
        "longitude": float(msg.longitude),
        "height": float(msg.height),
        "attitude_head": float(msg.attitude_head),
        "speed_x": float(msg.speed_x),
        "speed_y": float(msg.speed_y),
        "speed_z": float(msg.speed_z),
        "gimbal_pitch": float(msg.gimbal_pitch),
        "gimbal_roll": float(msg.gimbal_roll),
        "gimbal_yaw": float(msg.gimbal_yaw),
        "source": "gRPC",
        "grpc_source_id": source_id,
        "data_type": "high_freq",
    }

    _maybe_store_drone_log("high_freq", result)
    return result


def debug_summary(resp) -> Dict[str, Any]:
    """调试：将 oneof 摘要转为 JSON 友好结构。"""
    which = resp.WhichOneof("status")
    if not which:
        return {"oneof": None}
    payload = MessageToDict(resp, preserving_proto_field_name=True)
    return {"oneof": which, "status": payload.get(which, {})}
