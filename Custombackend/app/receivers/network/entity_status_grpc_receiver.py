"""EntityStatusService gRPC 客户端（订阅无人机自报位/任务/高频）。"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional

import grpc
from loguru import logger

_BRIDGE_DIR = Path(__file__).resolve().parents[2] / "bridge" / "grpc_generated"
if str(_BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(_BRIDGE_DIR))

from entity_status_pb2 import EntityStatusRequest  # noqa: E402
from entity_status_pb2_grpc import EntityStatusServiceStub  # noqa: E402

from parsers.entity_status_grpc_parser import parse_entity_status_response  # noqa: E402


class EntityStatusGrpcReceiver:
    """后台线程订阅 EntityStatusMethod 服务端流。"""

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
        self._thread: Optional[threading.Thread] = None
        self._channel: Optional[grpc.Channel] = None

    @property
    def target(self) -> str:
        return f"{self.host}:{self.port}"

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            name=f"entity-status-grpc-{self.receiver_id}",
            daemon=True,
        )
        self._thread.start()
        logger.info(f"✅ EntityStatus gRPC 订阅已启动 [{self.receiver_id}] → {self.target}")

    def stop(self) -> None:
        self._stop.set()
        if self._channel is not None:
            try:
                self._channel.close()
            except Exception:
                pass
            self._channel = None
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
        self._thread = None

    def _run_loop(self) -> None:
        backoff_sec = 1.0
        while not self._stop.is_set():
            try:
                self._subscribe_once()
                backoff_sec = 1.0
            except grpc.RpcError as e:
                if self._stop.is_set():
                    break
                logger.warning(
                    f"EntityStatus gRPC 流中断 [{self.receiver_id}] {self.target}: "
                    f"{e.code()} {e.details()}"
                )
            except Exception as e:
                if self._stop.is_set():
                    break
                logger.error(f"EntityStatus gRPC 订阅异常 [{self.receiver_id}] {self.target}: {e}")
            if self._stop.wait(backoff_sec):
                break
            backoff_sec = min(backoff_sec * 2, 30.0)

    def _subscribe_once(self) -> None:
        options = [
            ("grpc.max_receive_message_length", 32 * 1024 * 1024),
            ("grpc.keepalive_time_ms", 10000),
            ("grpc.keepalive_timeout_ms", 5000),
            ("grpc.keepalive_permit_without_calls", 1),
        ]
        self._channel = grpc.insecure_channel(self.target, options=options)
        grpc.channel_ready_future(self._channel).result(timeout=10)
        stub = EntityStatusServiceStub(self._channel)
        # 长期服务端流：勿设短 timeout（否则约 30s 整段 RPC 被掐断，高频图标会「动一会→停→再动」）。
        # 断线/僵死靠 channel keepalive；与 new_track_struct_grpc_receiver 一致。
        stream = stub.EntityStatusMethod(EntityStatusRequest())
        logger.info(f"EntityStatus gRPC 已连接 [{self.receiver_id}] {self.target}")
        for resp in stream:
            if self._stop.is_set():
                break
            parsed = parse_entity_status_response(resp, source_id=self.receiver_id)
            if parsed and self.data_callback:
                self.data_callback(parsed)
        if self._channel is not None:
            self._channel.close()
            self._channel = None
