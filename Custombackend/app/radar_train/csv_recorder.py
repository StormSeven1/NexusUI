"""探鸟雷达持续采集 → tracks_*.csv（含 is_uav）。"""
from __future__ import annotations

import csv
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from loguru import logger

from radar_train.label_store import label_store
from radar_train.udp_packet import parse_bird_radar_ml_packet

START_LEN = 15
AUTO_IDLE_SEC = 60
# 采集用：仅当前仍刷自报位+探鸟的融合真值（秒）
QUALIFYING_FRESH_SEC = 20.0
DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "radar_train_captures"

CSV_COLUMNS = [
    "recv_time",
    "pihao",
    "point_len",
    "timestamp",
    "timestamp_sec",
    "state",
    "state1",
    "state2",
    "rng",
    "azi",
    "elv",
    "radVel",
    "vel",
    "rcs",
    "class_num",
    "jem",
    "orig_jem",
    "fdEx",
    "infer_flag",
    "pre_raw",
    "prob_bird",
    "prob_uav",
    "score",
    "final_label",
    "final_label_str",
    "is_uav",
]


def _label_to_final(label_gt: Optional[int]) -> tuple[int, str]:
    if label_gt == 1:
        return 3, "无人机"
    if label_gt == 0:
        return 6, "鸟"
    return 15, "未知"


class CaptureSession:
    def __init__(self, output_path: Path, reason: str = "") -> None:
        self.id = uuid.uuid4().hex[:12]
        self.output_path = output_path
        self.reason = reason
        self.started_at = time.time()
        self.stopped_at: Optional[float] = None
        self.stop_reason = ""
        self.row_count = 0
        self._file = output_path.open("w", newline="", encoding="utf-8")
        self._writer = csv.DictWriter(self._file, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        self._writer.writeheader()
        self._file.flush()

    @property
    def active(self) -> bool:
        return self.stopped_at is None

    def close(self, reason: str = "") -> None:
        if self.stopped_at is not None:
            return
        self.stop_reason = reason
        self.stopped_at = time.time()
        try:
            self._file.flush()
            self._file.close()
        except OSError:
            pass

    def write_row(self, row: Dict[str, Any]) -> None:
        self._writer.writerow(row)
        self._file.flush()
        self.row_count += 1


class CaptureManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._history: Dict[int, List[Dict[str, Any]]] = {}
        self._session: Optional[CaptureSession] = None
        self._uav_pihaos: Set[int] = set()
        self._last_qualifying_at: float = 0.0
        self._recent_files: List[Dict[str, Any]] = []
        self.auto_idle_sec = AUTO_IDLE_SEC
        self.qualifying_fresh_sec = QUALIFYING_FRESH_SEC
        self._sniffer = None  # BirdRadarUdpSniffer：旁路嗅探，不抢 start.py 的 8001
        self._last_uav_refresh_at: float = 0.0

    def _refresh_uav_pihaos(self) -> Set[int]:
        """仅保留当前仍鲜活的「自报位+探鸟」批号。"""
        pihaos: Set[int] = set()
        for item in label_store.list_fresh(self.qualifying_fresh_sec):
            if int(item.get("label_gt", -1)) == 1:
                pihaos.add(int(item["pihao"]))
        self._uav_pihaos = pihaos
        self._last_uav_refresh_at = time.time()
        return pihaos

    def touch_qualifying_track(self, pihao: Optional[int] = None) -> None:
        """对空融合命中自报位+探鸟时刷新活跃时间与当前 UAV 批号集合。"""
        with self._lock:
            self._last_qualifying_at = time.time()
            self._refresh_uav_pihaos()
            # 刚触达的批号一定算当前（避免和 last_seen 时钟差 1s 误剔）
            if pihao is not None:
                self._uav_pihaos.add(int(pihao))

    def check_can_start(self) -> Dict[str, Any]:
        uav_items = [
            x
            for x in label_store.list_fresh(self.qualifying_fresh_sec)
            if int(x.get("label_gt", -1)) == 1
        ]
        if not uav_items:
            return {
                "ok": False,
                "message": "当前没有同时含自报位与探鸟雷达的对空融合航迹，无法开始采集",
                "qualifying_count": 0,
                "items": [],
                "fresh_sec": self.qualifying_fresh_sec,
            }
        return {
            "ok": True,
            "message": "可以开始采集",
            "qualifying_count": len(uav_items),
            "items": uav_items,
            "pihaos": sorted(int(x["pihao"]) for x in uav_items),
            "fresh_sec": self.qualifying_fresh_sec,
        }

    def _start_sniffer(self) -> Dict[str, Any]:
        """启动 AF_PACKET 旁路嗅探（不 bind 8001，不影响 start.py）。"""
        self._stop_sniffer()
        try:
            from radar_train.udp_sniffer import BirdRadarUdpSniffer
        except Exception as e:
            return {"ok": False, "message": f"旁路嗅探模块加载失败: {e}"}

        sniffer = BirdRadarUdpSniffer(on_payload=self.on_udp_message)
        if not sniffer.start():
            return {
                "ok": False,
                "message": "旁路嗅探启动失败（无 CAP_NET_RAW 或可用网卡）",
            }
        self._sniffer = sniffer
        return {"ok": True, "mode": "af_packet_sniff"}

    def _stop_sniffer(self) -> None:
        sniffer = self._sniffer
        self._sniffer = None
        if sniffer is not None:
            try:
                sniffer.stop()
            except Exception as e:
                logger.warning("停止探鸟旁路嗅探异常: {}", e)

    def start_recording(self, reason: str = "manual") -> Dict[str, Any]:
        check = self.check_can_start()
        if not check.get("ok"):
            return {"ok": False, **check}

        with self._lock:
            if self._session and self._session.active:
                return {
                    "ok": False,
                    "message": "采集已在进行中",
                    "session_id": self._session.id,
                    "output_path": str(self._session.output_path),
                }

            DATA_DIR.mkdir(parents=True, exist_ok=True)
            fname = f"tracks_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            path = DATA_DIR / fname
            self._session = CaptureSession(path, reason=reason)
            self._last_qualifying_at = time.time()
            self._refresh_uav_pihaos()
            self._history.clear()
            session = self._session

        sniff = self._start_sniffer()
        if not sniff.get("ok"):
            with self._lock:
                if self._session is session:
                    session.close(reason="sniffer_failed")
                    self._session = None
            return {
                "ok": False,
                "message": sniff.get("message") or "旁路嗅探启动失败",
            }

        logger.info(
            "探鸟采集开始 → {} pihaos={} ({}) sniff={}",
            fname,
            check.get("pihaos"),
            reason,
            sniff.get("mode"),
        )
        return {
            "ok": True,
            "session_id": session.id,
            "output_path": str(path),
            "filename": fname,
            "pihaos": check.get("pihaos"),
            "qualifying_count": check.get("qualifying_count"),
            "reason": reason,
            "capture_mode": "af_packet_sniff",
            "note": "旁路嗅探 UDP:8001，不停止 start.py",
        }

    def stop_recording(self, reason: str = "manual") -> Dict[str, Any]:
        self._stop_sniffer()
        with self._lock:
            session = self._session
            if not session or not session.active:
                return {"ok": False, "message": "当前没有进行中的采集"}

            session.close(reason=reason)
            meta = {
                "session_id": session.id,
                "path": str(session.output_path),
                "filename": session.output_path.name,
                "row_count": session.row_count,
                "started_at": datetime.fromtimestamp(session.started_at).isoformat(),
                "stopped_at": datetime.fromtimestamp(session.stopped_at or time.time()).isoformat(),
                "stop_reason": reason,
                "pihaos": sorted(self._uav_pihaos),
            }
            self._recent_files.append(meta)
            self._session = None

        logger.info(
            "探鸟采集结束: {} 行 → {} ({})",
            meta["row_count"],
            meta["filename"],
            reason,
        )
        return {"ok": True, **meta}

    def maybe_auto_stop_idle(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            session = self._session
            if not session or not session.active:
                return None
            if self._last_qualifying_at <= 0:
                return None
            idle = time.time() - self._last_qualifying_at
            if idle < self.auto_idle_sec:
                return None
        return self.stop_recording(reason=f"auto_idle_{int(self.auto_idle_sec)}s")

    def on_udp_message(self, message: bytes) -> int:
        targets, _ = parse_bird_radar_ml_packet(message)
        if not targets:
            return 0

        recv_time = datetime.now().isoformat(sep=" ", timespec="microseconds")
        written = 0

        with self._lock:
            session = self._session
            if not session or not session.active:
                return 0

            # 定期按「当前仍鲜活」刷新 is_uav 集合，踢掉已无自报位+探鸟的历史批号
            if time.time() - self._last_uav_refresh_at >= 2.0:
                self._refresh_uav_pihaos()

            uav_set = set(self._uav_pihaos)

            for t in targets:
                pihao = int(t["pihao"])
                hist = self._history.setdefault(pihao, [])
                hist.append(t)
                point_len = len(hist)

                is_uav = 1 if pihao in uav_set else 0
                label_gt = 1 if is_uav else None
                final_label, final_label_str = _label_to_final(label_gt)
                infer_flag = point_len >= START_LEN

                row = {
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
                    "infer_flag": infer_flag,
                    "pre_raw": 0,
                    "prob_bird": 0.0 if is_uav else 1.0,
                    "prob_uav": 1.0 if is_uav else 0.0,
                    "score": 799 if infer_flag and is_uav else (798 if infer_flag else 0),
                    "final_label": final_label,
                    "final_label_str": final_label_str,
                    "is_uav": is_uav,
                }
                session.write_row(row)
                written += 1

        return written

    def status(self) -> Dict[str, Any]:
        auto_meta = self.maybe_auto_stop_idle()
        with self._lock:
            session = self._session
            recording = bool(session and session.active)
            active_info = None
            if recording and session:
                idle_sec = time.time() - self._last_qualifying_at if self._last_qualifying_at > 0 else 0
                active_info = {
                    "session_id": session.id,
                    "row_count": session.row_count,
                    "output_path": str(session.output_path),
                    "filename": session.output_path.name,
                    "started_at": datetime.fromtimestamp(session.started_at).isoformat(),
                    "pihaos": sorted(self._uav_pihaos),
                    "idle_sec": round(idle_sec, 1),
                    "auto_stop_in_sec": max(0.0, round(self.auto_idle_sec - idle_sec, 1)),
                    "reason": session.reason,
                }
            files = list(reversed(self._recent_files[-20:]))

        return {
            "recording": recording,
            "active": active_info,
            "auto_idle_sec": self.auto_idle_sec,
            "recent_files": files,
            "data_dir": str(DATA_DIR),
            "auto_stopped": auto_meta,
        }


capture_manager = CaptureManager()
