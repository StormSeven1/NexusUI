#!/usr/bin/env python3
"""独立 10s 探鸟 UDP 采集测试（8001 已被 start.py 占用时用 tcpdump 旁路抓包）。"""
from __future__ import annotations

import csv
import struct
import subprocess
import sys
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "app"
sys.path.insert(0, str(APP_DIR))

from radar_train.udp_packet import parse_bird_radar_ml_packet  # noqa: E402

CSV_COLUMNS = [
    "recv_time", "pihao", "point_len", "timestamp", "timestamp_sec",
    "state", "state1", "state2", "rng", "azi", "elv", "radVel", "vel", "rcs",
    "class_num", "jem", "orig_jem", "fdEx", "infer_flag", "pre_raw",
    "prob_bird", "prob_uav", "score", "final_label", "final_label_str",
]
START_LEN = 15
DURATION_SEC = 10
OUT_DIR = APP_DIR / "data" / "radar_train_captures"


def _extract_udp_payload(link_packet: bytes) -> bytes | None:
    """LINUX_SLL (16) + IP + UDP payload."""
    if len(link_packet) < 16 + 20:
        return None
    ip_off = 16
    ver_ihl = link_packet[ip_off]
    ihl = (ver_ihl & 0x0F) * 4
    if link_packet[ip_off + 9] != 17:
        return None
    udp_off = ip_off + ihl
    if len(link_packet) < udp_off + 8:
        return None
    ulen = struct.unpack("!H", link_packet[udp_off + 4 : udp_off + 6])[0]
    payload = link_packet[udp_off + 8 : udp_off + ulen]
    return payload


def read_pcap_udp_payloads(pcap_path: Path) -> list[bytes]:
    out: list[bytes] = []
    with pcap_path.open("rb") as f:
        f.read(24)
        while True:
            hdr = f.read(16)
            if len(hdr) < 16:
                break
            _ts_sec, _ts_usec, incl_len, _orig = struct.unpack("IIII", hdr)
            pkt = f.read(incl_len)
            if len(pkt) < incl_len:
                break
            payload = _extract_udp_payload(pkt)
            if payload:
                out.append(payload)
    return out


def capture_with_tcpdump(duration_sec: int, pcap_path: Path) -> None:
    cmd = [
        "timeout", str(duration_sec),
        "tcpdump", "-i", "any", "-n", "-s", "65535", "-w", str(pcap_path),
        "udp", "port", "8001",
    ]
    print(f"采集中 {duration_sec}s: {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, check=False, capture_output=True)


def rows_from_payloads(payloads: list[bytes], target_pihaos: set[int] | None = None) -> list[dict]:
    history: dict[int, list] = defaultdict(list)
    rows: list[dict] = []
    for raw in payloads:
        targets, _ = parse_bird_radar_ml_packet(raw)
        if not targets:
            continue
        recv_time = datetime.now().isoformat(sep=" ", timespec="microseconds")
        for t in targets:
            pihao = int(t["pihao"])
            if target_pihaos and pihao not in target_pihaos:
                continue
            history[pihao].append(t)
            point_len = len(history[pihao])
            rows.append({
                "recv_time": recv_time,
                "pihao": pihao,
                "point_len": point_len,
                "timestamp": t["timestamp"],
                "timestamp_sec": t["timestamp_sec"],
                "state": t["state"],
                "state1": t["state1"],
                "state2": t["state2"],
                "rng": t["rng"],
                "azi": t["azi"],
                "elv": t["elv"],
                "radVel": t["radVel"],
                "vel": t["vel"],
                "rcs": t["rcs"],
                "class_num": t["class_num"],
                "jem": t["jem"],
                "orig_jem": t["orig_jem"],
                "fdEx": t["fdEx"],
                "infer_flag": point_len >= START_LEN,
                "pre_raw": 0,
                "prob_bird": 1.0,
                "prob_uav": 0.0,
                "score": 0,
                "final_label": 15,
                "final_label_str": "未知",
            })
    return rows


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    pcap_path = OUT_DIR / f"_capture_{ts}.pcap"
    csv_path = OUT_DIR / f"tracks_{ts}.csv"

    t0 = time.time()
    capture_with_tcpdump(DURATION_SEC, pcap_path)
    elapsed = time.time() - t0

    payloads = read_pcap_udp_payloads(pcap_path)
    rows = rows_from_payloads(payloads)

    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    pihaos = sorted({r["pihao"] for r in rows})
    print(f"完成: {elapsed:.1f}s, UDP包={len(payloads)}, CSV行={len(rows)}, 批号={pihaos}")
    print(f"CSV: {csv_path}")
    if rows:
        print("首行:", {k: rows[0][k] for k in ("pihao", "point_len", "rng", "azi", "rcs")})
        print("末行:", {k: rows[-1][k] for k in ("pihao", "point_len", "rng", "azi", "rcs")})
    else:
        print("警告: 未解析到有效 0x1010 点迹包")

    try:
        pcap_path.unlink()
    except OSError:
        pass


if __name__ == "__main__":
    main()
