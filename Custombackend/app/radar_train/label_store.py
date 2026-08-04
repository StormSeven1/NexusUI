"""探鸟雷达批号真值内存表 + 可选 JSONL 落盘。"""
from __future__ import annotations

import json
import queue as _queue
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from loguru import logger

DEFAULT_TTL_SEC = 2 * 60 * 60
DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "radar_train_labels"

# 落盘队列上限：满则丢最旧（真值可从内存表/后续帧恢复，绝不阻塞采集热路径）
_PERSIST_QUEUE_MAXSIZE = 20000
# 后台维护线程定时 prune 间隔（秒）
_PRUNE_INTERVAL_SEC = 60.0


class RadarTrainLabelStore:
    def __init__(self, ttl_sec: int = DEFAULT_TTL_SEC, persist: bool = True) -> None:
        self._lock = threading.Lock()
        self._labels: Dict[int, Dict[str, Any]] = {}
        self._ttl_sec = max(60, int(ttl_sec))
        self._persist = persist
        if self._persist:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
        # 异步落盘 + 定时 prune 的后台维护线程（惰性启动，避免仅 import 就起线程）
        self._write_q: "_queue.Queue[Dict[str, Any]]" = _queue.Queue(maxsize=_PERSIST_QUEUE_MAXSIZE)
        self._maint_lock = threading.Lock()
        self._maintenance_started = False

    def _now_iso(self) -> str:
        return datetime.now().isoformat()

    def _ensure_maintenance_started(self) -> None:
        """首次 upsert 时惰性启动维护线程：批量落盘 + 定时 prune（守护线程，随进程退出）。"""
        if self._maintenance_started:
            return
        with self._maint_lock:
            if self._maintenance_started:
                return
            t = threading.Thread(
                target=self._maintenance_loop,
                name="radar-train-label-maint",
                daemon=True,
            )
            t.start()
            self._maintenance_started = True

    def _maintenance_loop(self) -> None:
        last_prune = time.monotonic()
        while True:
            rows: List[Dict[str, Any]] = []
            try:
                # 阻塞等第一条，最多 1s 醒一次以便定时 prune
                rows.append(self._write_q.get(timeout=1.0))
                while len(rows) < 1000:
                    rows.append(self._write_q.get_nowait())
            except _queue.Empty:
                pass
            if rows:
                self._flush_rows(rows)
            now = time.monotonic()
            if now - last_prune >= _PRUNE_INTERVAL_SEC:
                try:
                    self.prune_expired()
                except Exception as e:  # noqa: BLE001 - 后台线程不因单次异常退出
                    logger.warning("雷达训练真值定时 prune 失败: {}", e)
                last_prune = now

    def _flush_rows(self, rows: List[Dict[str, Any]]) -> None:
        """批量把多行合并成一次 open→write→close（大幅降低 syscall；且发生在后台线程，不占热路径）。"""
        if not self._persist:
            return
        by_day: Dict[str, List[str]] = {}
        for row in rows:
            day = datetime.now().strftime("%Y-%m-%d")
            by_day.setdefault(day, []).append(json.dumps(row, ensure_ascii=False))
        for day, lines in by_day.items():
            path = DATA_DIR / f"uav_gt_{day}.jsonl"
            try:
                with path.open("a", encoding="utf-8") as f:
                    f.write("\n".join(lines) + "\n")
            except OSError as e:
                logger.warning("雷达训练真值落盘失败: {}", e)

    def _persist_row(self, row: Dict[str, Any]) -> None:
        """入队交后台线程写；不再在 gRPC 回调线程里同步 open/write/close。"""
        if not self._persist:
            return
        try:
            self._write_q.put_nowait(row)
        except _queue.Full:
            # 落盘落后于采集：丢最旧一条腾位，绝不阻塞热路径
            try:
                self._write_q.get_nowait()
                self._write_q.put_nowait(row)
            except (_queue.Empty, _queue.Full):
                pass

    def upsert(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        self._ensure_maintenance_started()
        pihao = int(entry["pihao"])
        now = self._now_iso()
        with self._lock:
            prev = self._labels.get(pihao)
            if prev:
                row = {
                    **prev,
                    **{k: v for k, v in entry.items() if k != "first_seen"},
                    "last_seen": now,
                    "update_count": int(prev.get("update_count", 1)) + 1,
                }
            else:
                row = {
                    **entry,
                    "first_seen": now,
                    "last_seen": now,
                    "update_count": 1,
                }
            self._labels[pihao] = row
        self._persist_row(row)
        return row

    def get(self, pihao: int) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._labels.get(int(pihao))
            return dict(row) if row else None

    def list_active(self) -> List[Dict[str, Any]]:
        self.prune_expired()
        with self._lock:
            return [dict(v) for v in sorted(self._labels.values(), key=lambda x: x.get("pihao", 0))]

    def list_fresh(self, fresh_sec: float) -> List[Dict[str, Any]]:
        """仅返回 last_seen 在 fresh_sec 内的条目（当前仍在刷新的融合真值）。"""
        self.prune_expired()
        cutoff = datetime.now() - timedelta(seconds=max(1.0, float(fresh_sec)))
        out: List[Dict[str, Any]] = []
        with self._lock:
            for row in self._labels.values():
                try:
                    last = datetime.fromisoformat(str(row.get("last_seen", "")))
                except ValueError:
                    continue
                if last >= cutoff:
                    out.append(dict(row))
        out.sort(key=lambda x: int(x.get("pihao", 0)))
        return out

    @staticmethod
    def _is_manual_row(row: Dict[str, Any]) -> bool:
        if row.get("manual") is True:
            return True
        src = str(row.get("label_source") or "")
        return src.startswith("manual")

    def list_uav_pihaos_for_csv(self, fresh_sec: float) -> List[int]:
        """
        CSV is_uav 用批号集合：
        - 自动真值：仅 fresh_sec 内仍刷新的（自报位+探鸟）
        - 手动「标为无人机」：在 TTL 内始终生效（不按 20s 踢出）
        """
        self.prune_expired()
        pihaos: set[int] = set()
        for item in self.list_fresh(fresh_sec):
            if int(item.get("label_gt", -1)) == 1:
                pihaos.add(int(item["pihao"]))
        with self._lock:
            for row in self._labels.values():
                if int(row.get("label_gt", -1)) != 1:
                    continue
                if not self._is_manual_row(row):
                    continue
                pihaos.add(int(row["pihao"]))
        return sorted(pihaos)

    def clear_manual(self, pihao: int) -> Optional[Dict[str, Any]]:
        """取消手动无人机标记；非手动条目不删除。"""
        p = int(pihao)
        with self._lock:
            row = self._labels.get(p)
            if not row or not self._is_manual_row(row):
                return None
            removed = dict(row)
            del self._labels[p]
            return removed

    def lookup_batch(self, pihaos: List[int]) -> Dict[int, Dict[str, Any]]:
        out: Dict[int, Dict[str, Any]] = {}
        for p in pihaos:
            row = self.get(int(p))
            if row:
                out[int(p)] = row
        return out

    def prune_expired(self) -> int:
        cutoff = datetime.now() - timedelta(seconds=self._ttl_sec)
        removed = 0
        with self._lock:
            dead = []
            for pihao, row in self._labels.items():
                try:
                    last = datetime.fromisoformat(str(row.get("last_seen", "")))
                except ValueError:
                    dead.append(pihao)
                    continue
                if last < cutoff:
                    dead.append(pihao)
            for pihao in dead:
                del self._labels[pihao]
                removed += 1
        return removed

    def stats(self) -> Dict[str, Any]:
        self.prune_expired()
        with self._lock:
            n = len(self._labels)
        return {
            "active_count": n,
            "ttl_sec": self._ttl_sec,
            "persist": self._persist,
            "data_dir": str(DATA_DIR),
        }

    def export_csv_rows(self) -> List[Dict[str, Any]]:
        rows = []
        for item in self.list_active():
            rows.append(
                {
                    "pihao": item.get("pihao"),
                    "label_gt": item.get("label_gt"),
                    "label_str": item.get("label_str"),
                    "label_source": item.get("label_source"),
                    "bird_radar_track_id": item.get("bird_radar_track_id"),
                    "self_report_track_ids": ",".join(str(x) for x in (item.get("self_report_track_ids") or [])),
                    "fuse_unique_id": item.get("fuse_unique_id"),
                    "fuse_track_id": item.get("fuse_track_id"),
                    "first_seen": item.get("first_seen"),
                    "last_seen": item.get("last_seen"),
                    "update_count": item.get("update_count"),
                }
            )
        return rows


label_store = RadarTrainLabelStore()
