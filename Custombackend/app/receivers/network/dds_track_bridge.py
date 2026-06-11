"""
航迹 DDS 桥接：独立子进程订阅，主进程收 Queue，与 Entity/相机 DDS 彻底隔离。
"""
from __future__ import annotations

import asyncio
import os
import tempfile
import time
import multiprocessing as mp
from multiprocessing import Queue
from typing import Any, Callable, Dict, List, Optional

from loguru import logger

from receivers.network.dds_track_worker import run_track_worker


class DDSTrackBridge:
    def __init__(self) -> None:
        self._process: Optional[mp.Process] = None
        self._mp_ctx = mp.get_context("spawn")
        self._queue: Optional[Queue] = None
        self._stop_token_path = ""
        self._on_data: Optional[Callable[[str, str, str, Dict[str, Any]], None]] = None
        self._subscription_matched: Dict[str, int] = {}
        self._track_receiver_ids: List[str] = []
        self._started_ids: List[str] = []
        self._fatal_error: str = ""
        self._ready = False

    @property
    def is_running(self) -> bool:
        return self._process is not None and self._process.is_alive()

    def start(
        self,
        track_configs: List[Dict[str, Any]],
        on_data: Callable[[str, str, str, Dict[str, Any]], None],
    ) -> None:
        if not track_configs:
            return
        if self.is_running:
            logger.warning("航迹 DDS 子进程已在运行，跳过重复启动")
            return

        self._on_data = on_data
        self._queue = self._mp_ctx.Queue(maxsize=5000)
        # 仅保留路径，启动时不创建文件（空文件会被 worker 误判为停止信号）
        self._stop_token_path = tempfile.mktemp(prefix="nexus_track_dds_stop_", suffix=".tok")

        self._process = self._mp_ctx.Process(
            target=run_track_worker,
            args=(track_configs, self._queue, self._stop_token_path),
            name="nexus-dds-track-worker",
            daemon=True,
        )
        self._process.start()
        self._track_receiver_ids = [c["id"] for c in track_configs]
        logger.info(
            "航迹 DDS 已迁入独立子进程 pid={}（{} 路，与 Entity/相机 同进程隔离）",
            self._process.pid,
            len(track_configs),
        )

    def drain_messages(self, max_batch: int = 200) -> int:
        if not self._queue:
            return 0
        n = 0
        while n < max_batch:
            try:
                msg = self._queue.get_nowait()
            except Exception:
                break
            n += 1
            kind = msg.get("kind")
            if kind == "data" and self._on_data:
                self._on_data(
                    msg["receiver_id"],
                    msg.get("topic_name", ""),
                    msg.get("source_name", ""),
                    msg.get("parsed") or {},
                )
            elif kind == "health":
                self._subscription_matched.update(msg.get("subscription_matched") or {})
            elif kind == "started":
                rid = msg.get("receiver_id", "")
                if rid and rid not in self._started_ids:
                    self._started_ids.append(rid)
            elif kind == "ready":
                self._ready = True
                self._track_receiver_ids = msg.get("receiver_ids") or self._track_receiver_ids
            elif kind == "start_error":
                logger.error(
                    "航迹 DDS 子进程启动失败 [{}]: {}",
                    msg.get("receiver_id"),
                    msg.get("error"),
                )
            elif kind == "fatal":
                self._fatal_error = msg.get("error", "unknown")
                logger.error("航迹 DDS 子进程致命错误: {}", self._fatal_error)
            elif kind == "stopped":
                self._ready = False
        return n

    def stop(self) -> None:
        if self._stop_token_path:
            try:
                with open(self._stop_token_path, "w", encoding="utf-8") as f:
                    f.write("stop")
            except OSError:
                pass
        if self._process and self._process.is_alive():
            self._process.join(timeout=8)
            if self._process.is_alive():
                self._process.terminate()
                self._process.join(timeout=3)
        self._process = None
        if self._stop_token_path and os.path.isfile(self._stop_token_path):
            try:
                os.remove(self._stop_token_path)
            except OSError:
                pass
        self._stop_token_path = ""

    def get_health(self, stats: Dict[str, Dict[str, int]]) -> Dict[str, Any]:
        track_ids = self._track_receiver_ids or self._started_ids
        matched = {rid: self._subscription_matched.get(rid, 0) for rid in track_ids}
        received = {rid: stats.get(rid, {}).get("received", 0) for rid in track_ids}
        return {
            "mode": "subprocess",
            "worker_pid": self._process.pid if self._process else None,
            "worker_alive": self.is_running,
            "ready": self._ready,
            "fatal_error": self._fatal_error or None,
            "track_receiver_ids": track_ids,
            "subscription_matched": matched,
            "received": received,
            "any_matched": any(v > 0 for v in matched.values()),
            "any_received": any(v > 0 for v in received.values()),
        }


_bridge: Optional[DDSTrackBridge] = None


def get_track_bridge() -> DDSTrackBridge:
    global _bridge
    if _bridge is None:
        _bridge = DDSTrackBridge()
    return _bridge


async def track_bridge_poll_loop(bridge: DDSTrackBridge, interval_sec: float = 0.02) -> None:
    while True:
        try:
            bridge.drain_messages()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("[dds_track_bridge] drain 异常: {}", exc)
        await asyncio.sleep(interval_sec)
