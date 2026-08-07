"""EntityStatusService gRPC 客户端（订阅无人机自报位/任务/高频）。

默认在**独立子进程**中收流 + pending 合批，再经 Queue 回主进程入 WS。
与 fuse_air 等高频航迹解析隔离 GIL，避免多机时 TCP/gRPC 缓冲堆旧帧导致三角滞后。
"""
from __future__ import annotations

import os
import sys
import tempfile
import threading
import multiprocessing as mp
from multiprocessing import Queue
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple

from loguru import logger

from receivers.network.entity_status_grpc_worker import run_entity_status_worker

_BRIDGE_DIR = Path(__file__).resolve().parents[2] / "bridge" / "grpc_generated"
if str(_BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(_BRIDGE_DIR))


def _hf_flush_interval_ms() -> float:
    """pending flush 间隔（ms）。默认 100；置 0 则子进程/收流线程逐帧解析。"""
    raw = os.getenv("NEXUS_ENTITY_HIGH_FREQ_FLUSH_MS")
    if raw is None or str(raw).strip() == "":
        raw = os.getenv("NEXUS_ENTITY_HIGH_FREQ_MIN_INTERVAL_MS", "100")
    try:
        return max(0.0, float(raw))
    except (TypeError, ValueError):
        return 100.0


def _hf_min_interval_ms() -> float:
    return _hf_flush_interval_ms()


def _use_subprocess() -> bool:
    """默认启用子进程；NEXUS_ENTITY_STATUS_GRPC_SUBPROCESS=0 可关回同进程。"""
    v = (os.getenv("NEXUS_ENTITY_STATUS_GRPC_SUBPROCESS") or "1").strip().lower()
    return v not in ("0", "false", "no", "off")


_PendingKey = Tuple[str, str]


def _slot_key(resp) -> Optional[_PendingKey]:
    which = resp.WhichOneof("status")
    if not which:
        return None
    if which == "high_freq_real_time_status":
        msg = resp.high_freq_real_time_status
        eid = (msg.base.entity_id or msg.drone_sn or "") or ""
        return (which, eid)
    if which == "drone_real_time_status":
        msg = resp.drone_real_time_status
        eid = (msg.base.entity_id or msg.drone_sn or "") or ""
        return (which, eid)
    if which == "drone_task_real_time_status":
        msg = resp.drone_task_real_time_status
        eid = (msg.base.entity_id or "") or ""
        return (which, eid)
    if which == "camera_real_time_status":
        msg = resp.camera_real_time_status
        eid = (msg.base.entity_id or "") or ""
        return (which, eid)
    return None


class EntityStatusGrpcReceiver:
    """主进程侧：默认拉起子进程收流，本进程只 drain Queue → data_callback。"""

    def __init__(
        self,
        config: Dict[str, Any],
        data_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ):
        self.config = config
        self.receiver_id = config["id"]
        self.name = config.get("name") or self.receiver_id
        self.host = config["host"]
        self.port = int(config["port"])
        self.data_callback = data_callback
        self._stop = threading.Event()
        self._hf_flush_interval_ms = _hf_flush_interval_ms()
        self._subprocess = _use_subprocess()

        self._mp_ctx = mp.get_context("spawn")
        self._process: Optional[mp.Process] = None
        self._queue: Optional[Queue] = None
        self._stop_token_path = ""
        self._drain_thread: Optional[threading.Thread] = None

        # 同进程回退路径
        self._thread: Optional[threading.Thread] = None
        self._flush_thread: Optional[threading.Thread] = None
        self._channel = None
        self._pending_lock = threading.Lock()
        self._pending: Dict[_PendingKey, Any] = {}

    @property
    def target(self) -> str:
        return f"{self.host}:{self.port}"

    def start(self) -> None:
        if self._subprocess:
            self._start_subprocess()
        else:
            self._start_inprocess()

    def stop(self) -> None:
        self._stop.set()
        if self._subprocess:
            self._stop_subprocess()
        else:
            self._stop_inprocess()

    def _start_subprocess(self) -> None:
        if self._process and self._process.is_alive():
            return
        self._stop.clear()
        self._queue = self._mp_ctx.Queue(maxsize=4000)
        self._stop_token_path = tempfile.mktemp(
            prefix=f"nexus_entity_grpc_stop_{self.receiver_id}_", suffix=".tok"
        )
        self._process = self._mp_ctx.Process(
            target=run_entity_status_worker,
            args=(
                self.host,
                self.port,
                self.receiver_id,
                self._queue,
                self._stop_token_path,
                self._hf_flush_interval_ms,
            ),
            name=f"entity-status-grpc-worker-{self.receiver_id}",
            daemon=True,
        )
        self._process.start()
        self._drain_thread = threading.Thread(
            target=self._drain_loop,
            name=f"entity-status-drain-{self.receiver_id}",
            daemon=True,
        )
        self._drain_thread.start()
        logger.info(
            f"✅ EntityStatus gRPC 子进程已启动 [{self.receiver_id}] → {self.target} "
            f"pid={self._process.pid} flush={self._hf_flush_interval_ms:.0f}ms"
        )

    def _drain_loop(self) -> None:
        q = self._queue
        if q is None:
            return
        while not self._stop.is_set():
            try:
                msg = q.get(timeout=0.2)
            except Exception:
                if self._process is not None and not self._process.is_alive():
                    if not self._stop.is_set():
                        logger.warning(
                            f"EntityStatus gRPC 子进程已退出 [{self.receiver_id}]，停止 drain"
                        )
                    break
                continue
            kind = msg.get("kind")
            if kind == "data":
                parsed = msg.get("parsed")
                if parsed and self.data_callback:
                    try:
                        self.data_callback(parsed)
                    except Exception as e:
                        logger.error(f"EntityStatus callback 异常 [{self.receiver_id}]: {e}")
            elif kind == "connected":
                logger.info(f"EntityStatus gRPC 已连接 [{self.receiver_id}] {self.target}")
            elif kind == "started":
                logger.debug(
                    f"EntityStatus worker started [{self.receiver_id}] pid={msg.get('pid')}"
                )
            elif kind == "error":
                logger.warning(f"EntityStatus worker [{self.receiver_id}]: {msg.get('error')}")
            elif kind == "stopped":
                logger.info(
                    f"EntityStatus worker 停止 [{self.receiver_id}] coalesced={msg.get('coalesced')}"
                )

    def _stop_subprocess(self) -> None:
        if self._stop_token_path:
            try:
                with open(self._stop_token_path, "w", encoding="utf-8") as f:
                    f.write("stop")
            except OSError:
                pass
        if self._process is not None and self._process.is_alive():
            self._process.join(timeout=5)
            if self._process.is_alive():
                self._process.terminate()
                self._process.join(timeout=3)
        self._process = None
        if self._drain_thread and self._drain_thread.is_alive():
            self._drain_thread.join(timeout=2)
        self._drain_thread = None
        if self._stop_token_path and os.path.isfile(self._stop_token_path):
            try:
                os.remove(self._stop_token_path)
            except OSError:
                pass
        self._stop_token_path = ""
        self._queue = None

    def _start_inprocess(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run_loop_inprocess,
            name=f"entity-status-grpc-{self.receiver_id}",
            daemon=True,
        )
        self._thread.start()
        if self._hf_flush_interval_ms > 0.0:
            self._flush_thread = threading.Thread(
                target=self._flush_loop_inprocess,
                name=f"entity-status-flush-{self.receiver_id}",
                daemon=True,
            )
            self._flush_thread.start()
        logger.info(
            f"✅ EntityStatus gRPC 同进程订阅已启动 [{self.receiver_id}] → {self.target} "
            f"(flush={self._hf_flush_interval_ms:.0f}ms；多机建议改用子进程)"
        )

    def _stop_inprocess(self) -> None:
        if self._channel is not None:
            try:
                self._channel.close()
            except Exception:
                pass
            self._channel = None
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
        self._thread = None
        if self._flush_thread and self._flush_thread.is_alive():
            self._flush_thread.join(timeout=2)
        self._flush_thread = None
        try:
            self._flush_pending_inprocess()
        except Exception:
            pass

    def _emit(self, resp) -> None:
        from parsers.entity_status_grpc_parser import parse_entity_status_response

        parsed = parse_entity_status_response(resp, source_id=self.receiver_id)
        if parsed and self.data_callback:
            self.data_callback(parsed)

    def _flush_pending_inprocess(self) -> None:
        with self._pending_lock:
            if not self._pending:
                return
            batch = self._pending
            self._pending = {}
        for resp in batch.values():
            self._emit(resp)

    def _flush_loop_inprocess(self) -> None:
        interval = max(0.02, self._hf_flush_interval_ms / 1000.0)
        while not self._stop.wait(interval):
            try:
                self._flush_pending_inprocess()
            except Exception as e:
                logger.error(f"EntityStatus flush 异常 [{self.receiver_id}]: {e}")

    def _run_loop_inprocess(self) -> None:
        import grpc
        from entity_status_pb2 import EntityStatusRequest
        from entity_status_pb2_grpc import EntityStatusServiceStub

        backoff = 1.0
        options = [
            ("grpc.max_receive_message_length", 32 * 1024 * 1024),
            ("grpc.keepalive_time_ms", 10000),
            ("grpc.keepalive_timeout_ms", 5000),
            ("grpc.keepalive_permit_without_calls", 1),
        ]
        while not self._stop.is_set():
            channel = None
            try:
                channel = grpc.insecure_channel(self.target, options=options)
                self._channel = channel
                grpc.channel_ready_future(channel).result(timeout=10)
                stub = EntityStatusServiceStub(channel)
                stream = stub.EntityStatusMethod(EntityStatusRequest())
                with self._pending_lock:
                    self._pending.clear()
                logger.info(f"EntityStatus gRPC 已连接 [{self.receiver_id}] {self.target}")
                coalesce = self._hf_flush_interval_ms > 0.0
                backoff = 1.0
                for resp in stream:
                    if self._stop.is_set():
                        break
                    if coalesce:
                        key = _slot_key(resp)
                        if key is not None:
                            with self._pending_lock:
                                self._pending[key] = resp
                            continue
                    self._emit(resp)
                self._flush_pending_inprocess()
            except Exception as e:
                if self._stop.is_set():
                    break
                logger.warning(
                    f"EntityStatus gRPC 流中断 [{self.receiver_id}] {self.target}: {e}"
                )
                if self._stop.wait(backoff):
                    break
                backoff = min(backoff * 2, 120.0)
            finally:
                if channel is not None:
                    try:
                        channel.close()
                    except Exception:
                        pass
                if self._channel is channel:
                    self._channel = None
