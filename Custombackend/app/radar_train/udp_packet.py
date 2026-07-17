"""探鸟雷达 ML UDP 包解析（与 start.py any_message 一致）。"""
from __future__ import annotations

import math
import struct
from typing import Any, Dict, List, Tuple


def timestamp_to_sec(timestamp: int) -> float:
    return timestamp * 25 / 1_000_000


def parse_bird_radar_ml_packet(message: bytes) -> Tuple[List[Dict[str, Any]], float]:
    """
    解析 0x1010 … 0x55aa 探鸟雷达 UDP 包。
    返回 (目标列表, current_time_sec)。
    """
    if len(message) < 28:
        return [], -1

    flag, = struct.unpack("h", message[:2])
    if flag != 0x1010:
        return [], -1

    head_data = message[2:26]
    total_size, = struct.unpack("h", head_data[2:4])
    target_num, = struct.unpack("H", head_data[22:24])
    if total_size != len(message):
        return [], -1

    end_flag, = struct.unpack("h", message[-2:])
    if end_flag != 0x55AA:
        return [], -1

    data_src = message[26 : 26 + target_num * 160]
    current_time = -1.0
    out: List[Dict[str, Any]] = []

    for i in range(target_num):
        data = data_src[i * 160 : (i + 1) * 160]
        if len(data) < 160:
            break

        state, = struct.unpack("B", data[0:1])
        state1 = state & 0x0F
        state2 = (state & 0xF0) >> 4
        pihao, = struct.unpack("H", data[2:4])
        timestamp, = struct.unpack("I", data[22:26])
        current_time = timestamp_to_sec(timestamp)

        rng, azi, elv = struct.unpack("IIi", data[26:38])
        rng = rng * 0.0001
        azi = azi * 0.00001
        elv = elv * 0.00001

        rad_vel, = struct.unpack("i", data[50:54])
        rad_vel = rad_vel * 0.01
        vel, = struct.unpack("I", data[58:62])
        vel = vel * 0.1

        rcs, = struct.unpack("h", data[82:84])
        rcs = rcs * 0.01

        class_num, = struct.unpack("B", data[84:85])

        jem, = struct.unpack("f", data[152:156])
        orig_jem = math.pow(10, jem / 10) if math.isfinite(jem) else 0.0
        fd_ex, = struct.unpack("f", data[156:160])

        out.append(
            {
                "pihao": int(pihao),
                "timestamp": int(timestamp),
                "timestamp_sec": float(current_time),
                "state": int(state),
                "state1": int(state1),
                "state2": int(state2),
                "rng": float(rng),
                "azi": float(azi),
                "elv": float(elv),
                "radVel": float(rad_vel),
                "vel": float(vel),
                "rcs": float(rcs),
                "class_num": int(class_num),
                "jem": float(jem) if math.isfinite(jem) else float("-inf"),
                "orig_jem": float(orig_jem),
                "fdEx": float(fd_ex),
            }
        )

    return out, current_time
