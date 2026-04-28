"""
虚兵 UDP 二进制协议解析 → 与 DDS 一致的 WebSocket 载荷（DroneStatus / HighFreq / DroneFlightPath）

航迹包（VirtualUnitTrack）布局 — 小端序，与典型 C++ packed struct + 长度前缀字符串 对齐：
  int32  type                 // 敌我 0=敌方 1=我方
  int32  side                 // 类型 1=无人机 2=巡飞弹 3=无人船
  double attitude_head
  double latitude
  double longitude
  double height
  double speed_x, speed_y, speed_z
  double gimbal_pitch, gimbal_roll, gimbal_yaw
  double horizontalFovDeg
  double verticalFovDeg       // C++ 拼写 verticaltalFovDeg 时仍按此字段发送
  double battery_percent
  uint16 len_drone_sn + UTF-8 bytes
  uint16 len_dock_sn  + UTF-8 bytes
  uint16 len_entityId + UTF-8 bytes   // 实体ID（新协议）；旧包无此段时按 entityId 空串解析

任务包（VirtualUnitDroneTask）布局：
  uint16 len_drone_sn + UTF-8 bytes
  uint32 waypoint_count
  重复 waypoint_count 次: double longitude, double latitude, double height
"""
from __future__ import annotations

import json
import math
import struct
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger

TRACK_FIXED_FMT = "<ii13d"  # 8 + 104 = 112 字节
TRACK_FIXED_SIZE = struct.calcsize(TRACK_FIXED_FMT)


def _speed_horizontal_vertical(sx: float, sy: float, sz: float) -> Tuple[float, float]:
    horizontal = math.sqrt(sx * sx + sy * sy)
    return horizontal, sz


def _build_drone_status_payload(
    *,
    drone_sn: str,
    dock_sn: str,
    entity_id: str,
    vu_type: int,
    vu_side: int,
    attitude_head: float,
    latitude: float,
    longitude: float,
    height: float,
    speed_x: float,
    speed_y: float,
    speed_z: float,
    gimbal_pitch: float,
    gimbal_roll: float,
    gimbal_yaw: float,
    horizontal_fov_deg: float,
    vertical_fov_deg: float,
    battery_percent: float,
) -> Dict[str, Any]:
    hs, vs = _speed_horizontal_vertical(speed_x, speed_y, speed_z)
    return {
        "drone_sn": drone_sn,
        "dock_sn": dock_sn,
        "entityId": entity_id,
        "latitude": latitude,
        "longitude": longitude,
        "height": height,
        "attitude_head": attitude_head,
        "attitude_pitch": None,
        "attitude_roll": None,
        "horizontal_speed": hs,
        "vertical_speed": vs,
        "gimbal_pitch": gimbal_pitch,
        "gimbal_roll": gimbal_roll,
        "gimbal_yaw": gimbal_yaw,
        "battery_percent": battery_percent,
        "virtual_unit_type": vu_type,
        "virtual_unit_side": vu_side,
        "horizontal_fov_deg": horizontal_fov_deg,
        "vertical_fov_deg": vertical_fov_deg,
        "source": "UDP",
        "data_type": "drone_status",
    }


def _build_high_freq_payload(
    *,
    drone_sn: str,
    dock_sn: str,
    entity_id: str,
    latitude: float,
    longitude: float,
    height: float,
    attitude_head: float,
    speed_x: float,
    speed_y: float,
    speed_z: float,
    gimbal_pitch: float,
    gimbal_roll: float,
    gimbal_yaw: float,
) -> Dict[str, Any]:
    return {
        "drone_sn": drone_sn,
        "dock_sn": dock_sn,
        "entityId": entity_id,
        "latitude": latitude,
        "longitude": longitude,
        "height": height,
        "attitude_head": attitude_head,
        "speed_x": speed_x,
        "speed_y": speed_y,
        "speed_z": speed_z,
        "gimbal_pitch": gimbal_pitch,
        "gimbal_roll": gimbal_roll,
        "gimbal_yaw": gimbal_yaw,
        "source": "UDP",
        "data_type": "high_freq",
    }


def parse_virtual_unit_track_binary(data: bytes) -> Optional[List[Dict[str, Any]]]:
    """解析虚兵航迹 UDP 二进制 → 返回待广播的 WebSocket 消息列表。"""
    if len(data) < TRACK_FIXED_SIZE + 4:
        logger.debug(f"虚兵航迹包过短: {len(data)}")
        return None
    try:
        unpacked = struct.unpack(TRACK_FIXED_FMT, data[:TRACK_FIXED_SIZE])
    except struct.error as e:
        logger.debug(f"虚兵航迹固定段解析失败: {e}")
        return None

    (
        vu_type,
        vu_side,
        attitude_head,
        latitude,
        longitude,
        height,
        speed_x,
        speed_y,
        speed_z,
        gimbal_pitch,
        gimbal_roll,
        gimbal_yaw,
        horizontal_fov_deg,
        vertical_fov_deg,
        battery_percent,
    ) = unpacked

    off = TRACK_FIXED_SIZE
    if len(data) < off + 2:
        return None
    ln1 = struct.unpack_from("<H", data, off)[0]
    off += 2
    if len(data) < off + ln1 + 2:
        return None
    drone_sn = data[off : off + ln1].decode("utf-8", errors="replace").strip("\x00")
    off += ln1
    ln2 = struct.unpack_from("<H", data, off)[0]
    off += 2
    if len(data) < off + ln2:
        return None
    dock_sn = data[off : off + ln2].decode("utf-8", errors="replace").strip("\x00")
    off += ln2

    entity_id = ""
    if off + 2 <= len(data):
        ln3 = struct.unpack_from("<H", data, off)[0]
        off += 2
        if len(data) < off + ln3:
            logger.debug(f"虚兵航迹 entityId 段长度不足: need {off + ln3}, got {len(data)}")
            return None
        entity_id = data[off : off + ln3].decode("utf-8", errors="replace").strip("\x00")
        off += ln3

    if not drone_sn:
        logger.warning("虚兵航迹包 drone_sn 为空，已丢弃")
        return None

    status = _build_drone_status_payload(
        drone_sn=drone_sn,
        dock_sn=dock_sn,
        entity_id=entity_id,
        vu_type=vu_type,
        vu_side=vu_side,
        attitude_head=attitude_head,
        latitude=latitude,
        longitude=longitude,
        height=height,
        speed_x=speed_x,
        speed_y=speed_y,
        speed_z=speed_z,
        gimbal_pitch=gimbal_pitch,
        gimbal_roll=gimbal_roll,
        gimbal_yaw=gimbal_yaw,
        horizontal_fov_deg=horizontal_fov_deg,
        vertical_fov_deg=vertical_fov_deg,
        battery_percent=battery_percent,
    )
    high = _build_high_freq_payload(
        drone_sn=drone_sn,
        dock_sn=dock_sn,
        entity_id=entity_id,
        latitude=latitude,
        longitude=longitude,
        height=height,
        attitude_head=attitude_head,
        speed_x=speed_x,
        speed_y=speed_y,
        speed_z=speed_z,
        gimbal_pitch=gimbal_pitch,
        gimbal_roll=gimbal_roll,
        gimbal_yaw=gimbal_yaw,
    )

    return [
        {"type": "DroneStatus", "data": status},
        {"type": "HighFreq", "data": high},
    ]


def parse_virtual_unit_track_json(data: bytes) -> Optional[List[Dict[str, Any]]]:
    try:
        o = json.loads(data.decode("utf-8"))
    except Exception:
        return None
    if not isinstance(o, dict):
        return None
    try:
        drone_sn = str(o.get("drone_sn", "")).strip()
        if not drone_sn:
            return None
        dock_sn = str(o.get("dock_sn", "") or "")
        entity_id = str(o.get("entityId", o.get("entity_id", "")) or "").strip()
        vu_type = int(o.get("type", 0))
        vu_side = int(o.get("side", 1))
        attitude_head = float(o["attitude_head"])
        latitude = float(o["latitude"])
        longitude = float(o["longitude"])
        height = float(o.get("height", 0))
        speed_x = float(o.get("speed_x", 0))
        speed_y = float(o.get("speed_y", 0))
        speed_z = float(o.get("speed_z", 0))
        gimbal_pitch = float(o.get("gimbal_pitch", 0))
        gimbal_roll = float(o.get("gimbal_roll", 0))
        gimbal_yaw = float(o.get("gimbal_yaw", 0))
        horizontal_fov_deg = float(o.get("horizontalFovDeg", o.get("horizontal_fov_deg", 0)))
        vertical_fov_deg = float(
            o.get("verticalFovDeg", o.get("verticaltalFovDeg", o.get("vertical_fov_deg", 0)))
        )
        battery_percent = float(o.get("battery_percent", 0))
    except (KeyError, TypeError, ValueError) as e:
        logger.debug(f"虚兵航迹 JSON 字段缺失或类型错误: {e}")
        return None

    status = _build_drone_status_payload(
        drone_sn=drone_sn,
        dock_sn=dock_sn,
        entity_id=entity_id,
        vu_type=vu_type,
        vu_side=vu_side,
        attitude_head=attitude_head,
        latitude=latitude,
        longitude=longitude,
        height=height,
        speed_x=speed_x,
        speed_y=speed_y,
        speed_z=speed_z,
        gimbal_pitch=gimbal_pitch,
        gimbal_roll=gimbal_roll,
        gimbal_yaw=gimbal_yaw,
        horizontal_fov_deg=horizontal_fov_deg,
        vertical_fov_deg=vertical_fov_deg,
        battery_percent=battery_percent,
    )
    high = _build_high_freq_payload(
        drone_sn=drone_sn,
        dock_sn=dock_sn,
        entity_id=entity_id,
        latitude=latitude,
        longitude=longitude,
        height=height,
        attitude_head=attitude_head,
        speed_x=speed_x,
        speed_y=speed_y,
        speed_z=speed_z,
        gimbal_pitch=gimbal_pitch,
        gimbal_roll=gimbal_roll,
        gimbal_yaw=gimbal_yaw,
    )
    return [
        {"type": "DroneStatus", "data": status},
        {"type": "HighFreq", "data": high},
    ]


def parse_virtual_unit_track(data: bytes) -> Optional[List[Dict[str, Any]]]:
    """虚兵航迹：优先 JSON（首字节为 '{'），否则按二进制解析。"""
    if data and data[0:1] == b"{":
        return parse_virtual_unit_track_json(data)
    return parse_virtual_unit_track_binary(data)


def parse_virtual_unit_drone_task_binary(data: bytes) -> Optional[Dict[str, Any]]:
    """虚兵任务 UDP 二进制 → 单条 WebSocket 消息（type DroneFlightPath）。"""
    if len(data) < 2 + 4:
        return None
    off = 0
    ln = struct.unpack_from("<H", data, off)[0]
    off += 2
    if len(data) < off + ln + 4:
        return None
    drone_sn = data[off : off + ln].decode("utf-8", errors="replace").strip("\x00")
    off += ln
    if not drone_sn:
        return None
    (n_wp,) = struct.unpack_from("<I", data, off)
    off += 4
    need = n_wp * 3 * 8
    if len(data) < off + need:
        logger.debug(f"虚兵任务航点长度不足: need {off + need}, got {len(data)}")
        return None

    waypoints: List[Dict[str, Any]] = []
    for i in range(n_wp):
        lon, lat, h = struct.unpack_from("<ddd", data, off)
        off += 24
        waypoints.append(
            {
                "index": i,
                "longitude": lon,
                "latitude": lat,
                "height": h,
            }
        )

    payload = {
        "entityId": drone_sn,
        "waypoints": waypoints,
        "source": "UDP",
        "data_type": "drone_task",
    }
    return {"type": "DroneFlightPath", "data": payload}


def parse_virtual_unit_drone_task_json(data: bytes) -> Optional[Dict[str, Any]]:
    try:
        o = json.loads(data.decode("utf-8"))
    except Exception:
        return None
    if not isinstance(o, dict):
        return None
    drone_sn = str(o.get("drone_sn", "")).strip()
    if not drone_sn:
        return None
    raw_wps = o.get("waypoints")
    if not isinstance(raw_wps, list):
        return None
    waypoints: List[Dict[str, Any]] = []
    for i, wp in enumerate(raw_wps):
        if not isinstance(wp, dict):
            continue
        waypoints.append(
            {
                "index": wp.get("index", i),
                "longitude": float(wp["longitude"]),
                "latitude": float(wp["latitude"]),
                "height": float(wp.get("height", 0)),
            }
        )
    if not waypoints:
        return None
    payload = {
        "entityId": drone_sn,
        "waypoints": waypoints,
        "source": "UDP",
        "data_type": "drone_task",
    }
    return {"type": "DroneFlightPath", "data": payload}


def parse_virtual_unit_drone_task(data: bytes) -> Optional[Dict[str, Any]]:
    if data and data[0:1] == b"{":
        return parse_virtual_unit_drone_task_json(data)
    return parse_virtual_unit_drone_task_binary(data)
