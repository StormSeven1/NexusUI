"""
高速相机 UDP：44 字节通用头 + 载荷（对齐 src/12-back/parsers/high_speed_camera_udp.py）。

- MSG_DEV_STATUS_BASIC：JSON → WebSocket type=SpeedCamera（整包转发）
- MSG_CAM_IMAGE_REPORT：解析检测框等元数据 → WebSocket type=SpeedCameraDetection（不含图像字节）
"""
from __future__ import annotations

import copy
import json
import struct
import time
from typing import Any, Dict, List, Tuple

from loguru import logger

PROTOCOL_MAGIC = 0xEB90
HEADER_SIZE = 44
HEADER_FMT = "<HH I HH I Q 8s 8s I"

MSG_DEV_HEARTBEAT = 0x1000
MSG_DEV_STATUS_BASIC = 0x1001
MSG_CAM_IMAGE_REPORT = 0x5001

BINARY_FRAME_DESC_SIZE = 74
BINARY_RECT_SIZE = 24

_reassemble: Dict[int, Dict[str, Any]] = {}
_REASSEMBLE_TTL_S = 3.0


def _clean_reassemble() -> None:
    now = time.monotonic()
    for k in [x for x in _reassemble if now - _reassemble[x]["t0"] > _REASSEMBLE_TTL_S]:
        del _reassemble[k]


def _entity_id_from_16(raw: bytes) -> str:
    z = raw.split(b"\x00", 1)[0]
    s = z.decode("utf-8", errors="ignore").strip()
    return s if s else "camera-hs-001"


def _parse_boxes(payload: bytes, rect_count: int) -> List[Dict[str, float]]:
    boxes: List[Dict[str, float]] = []
    for i in range(rect_count):
        ro = BINARY_FRAME_DESC_SIZE + i * BINARY_RECT_SIZE
        if ro + BINARY_RECT_SIZE > len(payload):
            break
        x, y, w, h = struct.unpack_from("<ffff", payload, ro + 8)
        boxes.append({"x": float(x), "y": float(y), "w": float(w), "h": float(h)})
    return boxes


def _handle_image_report(payload: bytes, source_name: str) -> List[Dict[str, Any]]:
    """解析 MSG_CAM_IMAGE_REPORT，整包检测信息推前端（不含图像数据）。"""
    out: List[Dict[str, Any]] = []
    if len(payload) < BINARY_FRAME_DESC_SIZE:
        return out

    entity_id = _entity_id_from_16(payload[:16])
    image_size = struct.unpack_from("<I", payload, 24)[0]
    width = struct.unpack_from("<H", payload, 28)[0]
    height = struct.unpack_from("<H", payload, 30)[0]
    rect_count = struct.unpack_from("<H", payload, 70)[0]

    boxes: List[Dict[str, float]] = []
    if rect_count > 0:
        need = BINARY_FRAME_DESC_SIZE + rect_count * BINARY_RECT_SIZE
        if len(payload) < need:
            logger.warning(
                f"[HighSpeedCamera] 图像帧长度不足: need>={need}, got={len(payload)}, entity={entity_id}"
            )
            return out
        boxes = _parse_boxes(payload, rect_count)

    data: Dict[str, Any] = {
        "entityId": entity_id,
        "rect_count": int(rect_count),
        "boxCount": int(rect_count),
        "boxes": boxes,
        "width": int(width),
        "height": int(height),
        "imageSize": int(image_size),
        "hasDetection": len(boxes) > 0,
        "source_name": source_name,
        "data_type": "speed_camera_detection",
    }
    out.append({"type": "SpeedCameraDetection", "data": data})
    if boxes:
        logger.info(
            f"[HighSpeedCamera] 检测帧 entity={entity_id} boxes={len(boxes)} "
            f"{width}x{height}"
        )
    return out


def _handle_basic_json(payload: bytes, source_name: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    try:
        text = payload.decode("utf-8", errors="ignore").strip()
        if not text:
            return out
        obj = json.loads(text)
        if not isinstance(obj, dict):
            return out
        eid = obj.get("entityId") or obj.get("entity_id")
        if not eid:
            return out
        eid = str(eid).strip()
        data = copy.deepcopy(obj)
        data["entityId"] = eid
        data["source_name"] = source_name
        data["data_type"] = "speed_camera_status"
        out.append({"type": "SpeedCamera", "data": data})
    except Exception as e:
        logger.debug(f"[HighSpeedCamera] MSG_DEV_STATUS_BASIC JSON 解析失败: {e}")
    return out


def parse_high_speed_camera_udp(data: bytes, source_name: str) -> Tuple[List[Dict[str, Any]], bool]:
    """返回 (待推送消息列表, 是否为合法本协议包)。"""
    out: List[Dict[str, Any]] = []
    if len(data) < HEADER_SIZE:
        return out, False

    magic, msg_type, sequence, total_packets, packet_index, data_len, _ts, _src, _tgt, _res = (
        struct.unpack(HEADER_FMT, data[:HEADER_SIZE])
    )

    if magic != PROTOCOL_MAGIC:
        return out, False

    if len(data) < HEADER_SIZE + data_len:
        logger.warning(
            f"[HighSpeedCamera] 长度不足: need {HEADER_SIZE + data_len}, got {len(data)}"
        )
        return out, False

    payload = data[HEADER_SIZE : HEADER_SIZE + data_len]

    if msg_type == MSG_DEV_HEARTBEAT:
        return out, True

    if msg_type == MSG_DEV_STATUS_BASIC:
        out.extend(_handle_basic_json(payload, source_name))
        return out, True

    if msg_type != MSG_CAM_IMAGE_REPORT:
        return out, True

    if total_packets <= 1:
        out.extend(_handle_image_report(payload, source_name))
        return out, True

    _clean_reassemble()
    seq = int(sequence)
    if seq not in _reassemble:
        _reassemble[seq] = {
            "total": int(total_packets),
            "parts": [None] * int(total_packets),
            "t0": time.monotonic(),
        }
    entry = _reassemble[seq]
    if int(total_packets) != entry["total"]:
        return out, True
    if packet_index >= len(entry["parts"]):
        return out, True
    entry["parts"][packet_index] = payload
    if all(p is not None for p in entry["parts"]):
        full = b"".join(entry["parts"])
        del _reassemble[seq]
        out.extend(_handle_image_report(full, source_name))
    return out, True
