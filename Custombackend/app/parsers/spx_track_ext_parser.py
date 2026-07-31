"""
Cambridge Pixel SPx Track Extended (TYPEB 0x112) UDP 解析。

布局对齐 third_party SPxPackets.h / track_simulator._build_packet（网络字节序 big-endian）。
用于探鸟雷达「智能跟踪航迹」组播（Config_Radar RadarNewTrackIP/Port）。
"""
from __future__ import annotations

import struct
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from loguru import logger

# SPxPackets.h: SPX_PACKET_MAGIC_B = ('C'<<8)|('B') = 0x4342
# 旧模拟器曾误用 0xA55A，一并兼容
SPX_PACKET_MAGIC_B = 0x4342
SPX_PACKET_MAGIC_B_LEGACY = 0xA55A
SPX_PACKET_TYPEB_TRACK_EXT = 0x112
_SPX_PACKET_MAGICS_B = frozenset({SPX_PACKET_MAGIC_B, SPX_PACKET_MAGIC_B_LEGACY})

SPX_PACKET_TRACK_STATUS_DELETED = 0

SPX_PACKET_TRACK_EXT_RADIALSPEED = 0x00000001
SPX_PACKET_TRACK_EXT_AGE = 0x00000002
SPX_PACKET_TRACK_EXT_LATLONG = 0x00000004
SPX_PACKET_TRACK_EXT_MSGTIME = 0x00000008
SPX_PACKET_TRACK_EXT_SENSORDATA = 0x00000010
SPX_PACKET_TRACK_EXT_ALTITUDE = 0x00000020
SPX_PACKET_TRACK_EXT_FUSION = 0x00000040
SPX_PACKET_TRACK_EXT_SECONDARY = 0x00000080
SPX_PACKET_TRACK_EXT_LATLONG_MEAS = 0x00000100
SPX_PACKET_TRACK_EXT_GATE = 0x00000200
SPX_PACKET_TRACK_EXT_CPA = 0x00000400
SPX_PACKET_TRACK_EXT_THREAT = 0x00000800
SPX_PACKET_TRACK_EXT_DESCRIPTION = 0x00001000
SPX_PACKET_TRACK_EXT_ACCEL = 0x00002000
SPX_PACKET_TRACK_EXT_MOTION_STATUS = 0x00004000

# HeaderB(16) 之后：SPxPacketTrackNormal = 112 bytes
_NORM_SIZE = 112
_HEADER_B_SIZE = 16
# SPxPacketTrackFusion / Secondary / Threat（按字段累加，4 字节对齐）
_FUSION_SIZE = 4 + 4 + 8 * 4 + 4 + 21 * 4  # 128
_SECONDARY_SIZE = 4 + 4 + 21 + 3 + 2 + 2 + 1 + 1 + 2 + 2 + 2 + 4 + 4 + 19 * 4  # 128
_THREAT_SIZE = 32 + 4 + 4 + 4 + 5 * 4  # 64


def _u32(data: bytes, off: int) -> int:
    return struct.unpack_from(">I", data, off)[0]


def _f32(data: bytes, off: int) -> float:
    return struct.unpack_from(">f", data, off)[0]


def parse_spx_track_ext_packet(data: bytes, source_id: str = "") -> Optional[List[Dict[str, Any]]]:
    """解析一帧 UDP 载荷，返回 0..N 条航迹（通常 1 条）。失败返回 None。"""
    if not data or len(data) < _HEADER_B_SIZE + _NORM_SIZE + 8:
        return None
    try:
        magic, ptype, total_size, time_secs, _time_usecs = struct.unpack_from(">HHIII", data, 0)
    except struct.error:
        return None
    if magic not in _SPX_PACKET_MAGICS_B or ptype != SPX_PACKET_TYPEB_TRACK_EXT:
        return None
    if total_size > 0 and total_size < len(data):
        data = data[:total_size]
    if len(data) < _HEADER_B_SIZE + _NORM_SIZE + 8:
        return None

    body = data[_HEADER_B_SIZE:]
    tracks: List[Dict[str, Any]] = []
    # 单包可含多条扩展航迹（少见）；按 netSize 推进
    offset = 0
    while offset + _NORM_SIZE + 8 <= len(body):
        track = _parse_one_extended(body, offset, time_secs, source_id)
        if track is None:
            break
        net_size = int(track.pop("_net_size", _NORM_SIZE + 8))
        if net_size < _NORM_SIZE + 8:
            break
        tracks.append(track)
        offset += net_size
        # 防御：异常 netSize 防止死循环
        if offset > len(body):
            break

    return tracks if tracks else None


def _parse_one_extended(
    body: bytes, offset: int, header_time_secs: int, source_id: str
) -> Optional[Dict[str, Any]]:
    """从 body[offset:] 解一条 SPxPacketTrackExtended（不含 HeaderB）。"""
    if offset + _NORM_SIZE + 8 > len(body):
        return None
    # Minimal
    track_id = _u32(body, offset + 0)
    status = body[offset + 5]
    range_m = _f32(body, offset + 8)
    azi_deg = _f32(body, offset + 12)
    speed_mps = _f32(body, offset + 16)
    course_deg = _f32(body, offset + 20)
    reserved1 = body[offset + 45]  # after flags at +44
    # Normal tail starts at +56
    track_class = struct.unpack_from(">H", body, offset + 56 + 40 + 2)[0]

    net_size = _u32(body, offset + _NORM_SIZE)
    ext_mask = _u32(body, offset + _NORM_SIZE + 4)
    if net_size < _NORM_SIZE + 8 or offset + net_size > len(body):
        # 容错：按剩余长度继续解可选字段
        net_size = len(body) - offset

    if status == SPX_PACKET_TRACK_STATUS_DELETED:
        return {
            "_net_size": net_size,
            "trackId": track_id,
            "uniqueId": str(track_id),
            "uniqueID": str(track_id),
            "deleted": True,
            "source": source_id or "UDP",
            "data_type": "radar_track",
        }

    pos = offset + _NORM_SIZE + 8
    lat = None
    lon = None
    altitude = None
    cpa = 0.0
    tcpa = 0.0
    msg_time_secs = header_time_secs
    secondary_unique = None
    secondary_name = None

    def need(n: int) -> bool:
        return pos + n <= offset + net_size and pos + n <= len(body)

    try:
        if ext_mask & SPX_PACKET_TRACK_EXT_RADIALSPEED:
            if not need(8):
                raise ValueError("radial")
            pos += 8
        if ext_mask & SPX_PACKET_TRACK_EXT_AGE:
            if not need(4):
                raise ValueError("age")
            pos += 4
        if ext_mask & SPX_PACKET_TRACK_EXT_LATLONG:
            if not need(8):
                raise ValueError("latlong")
            lat = _f32(body, pos)
            lon = _f32(body, pos + 4)
            pos += 8
        if ext_mask & SPX_PACKET_TRACK_EXT_MSGTIME:
            if not need(8):
                raise ValueError("msgtime")
            msg_time_secs = _u32(body, pos)
            pos += 8
        if ext_mask & SPX_PACKET_TRACK_EXT_SENSORDATA:
            if not need(4):
                raise ValueError("sensordata_len")
            nbytes = _u32(body, pos)
            pos += 4
            nbytes = min(max(nbytes, 0), 32)
            if not need(nbytes):
                raise ValueError("sensordata")
            pos += nbytes
        if ext_mask & SPX_PACKET_TRACK_EXT_ALTITUDE:
            if not need(4):
                raise ValueError("alt")
            altitude = _f32(body, pos)
            pos += 4
        if ext_mask & SPX_PACKET_TRACK_EXT_FUSION:
            if not need(_FUSION_SIZE):
                raise ValueError("fusion")
            pos += _FUSION_SIZE
        if ext_mask & SPX_PACKET_TRACK_EXT_SECONDARY:
            if not need(_SECONDARY_SIZE):
                raise ValueError("secondary")
            secondary_unique = _u32(body, pos + 4)
            name_raw = body[pos + 8 : pos + 29]
            secondary_name = name_raw.split(b"\x00", 1)[0].decode("utf-8", errors="ignore").strip() or None
            pos += _SECONDARY_SIZE
        if ext_mask & SPX_PACKET_TRACK_EXT_LATLONG_MEAS:
            if not need(8):
                raise ValueError("latlong_meas")
            if lat is None:
                lat = _f32(body, pos)
                lon = _f32(body, pos + 4)
            pos += 8
        if ext_mask & SPX_PACKET_TRACK_EXT_GATE:
            if not need(16):
                raise ValueError("gate")
            pos += 16
        if ext_mask & SPX_PACKET_TRACK_EXT_CPA:
            if not need(8):
                raise ValueError("cpa")
            cpa = _f32(body, pos)
            tcpa = _f32(body, pos + 4)
            pos += 8
        if ext_mask & SPX_PACKET_TRACK_EXT_THREAT:
            if not need(_THREAT_SIZE):
                raise ValueError("threat")
            pos += _THREAT_SIZE
        if ext_mask & SPX_PACKET_TRACK_EXT_DESCRIPTION:
            if not need(2):
                raise ValueError("desc_len")
            desc_net = struct.unpack_from(">H", body, pos)[0]
            pos += 2
            # 结构含 description[62]，网上可能是 descNetSize 字节
            take = min(max(int(desc_net), 0), 62)
            if not need(take):
                # 回退按定长 62
                take = 62 if need(62) else 0
            pos += take
        if ext_mask & SPX_PACKET_TRACK_EXT_ACCEL:
            if not need(8):
                raise ValueError("accel")
            pos += 8
        if ext_mask & SPX_PACKET_TRACK_EXT_MOTION_STATUS:
            if not need(2):
                raise ValueError("motion")
            pos += 2
    except ValueError as e:
        logger.debug(f"SPx TrackExt 可选字段截断 [{source_id}] id={track_id} mask=0x{ext_mask:x}: {e}")

    if lat is None or lon is None:
        logger.debug(f"SPx TrackExt 无经纬度 [{source_id}] id={track_id} mask=0x{ext_mask:x}")
        return {"_net_size": net_size, "deleted": True, "trackId": track_id}

    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return {"_net_size": net_size, "deleted": True, "trackId": track_id}

    uid = str(secondary_unique) if secondary_unique else str(track_id)
    ts = msg_time_secs if msg_time_secs > 0 else int(time.time())
    try:
        ts_iso = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        ts_iso = datetime.now(timezone.utc).isoformat()

    # 分类：与 Widget IteratorAirTrack 一致（reserved1 / trackClass）
    class_id = int(track_class) if track_class else int(reserved1 or 0)

    return {
        "_net_size": net_size,
        "trackId": track_id,
        "uniqueId": uid,
        "uniqueID": uid,
        "latitude": float(lat),
        "longitude": float(lon),
        "altitude": float(altitude) if altitude is not None else 0.0,
        "height": float(altitude) if altitude is not None else 0.0,
        "course": float(course_deg),
        "speed": float(speed_mps),
        "azimuth": float(azi_deg),
        "range": float(range_m),
        "cpa": float(cpa),
        "tcpa": float(tcpa),
        "trackCategoryId": class_id if class_id else None,
        "trackCategoryName": secondary_name,
        "timestamp": ts_iso,
        "source": source_id or "UDP",
        "data_type": "radar_track",
        "target_type": "AutoBirdRadar",
        "is_air_track": True,
    }


def parse_spx_track_ext_to_tracks(data: bytes, source_id: str = "") -> Optional[List[Dict[str, Any]]]:
    """供 TrackParser / receiver 调用：过滤 deleted，去掉内部字段。"""
    raw = parse_spx_track_ext_packet(data, source_id)
    if not raw:
        return None
    out: List[Dict[str, Any]] = []
    for t in raw:
        if not t or t.get("deleted"):
            continue
        t.pop("_net_size", None)
        if t.get("latitude") is None or t.get("longitude") is None:
            continue
        out.append(t)
    return out if out else None
