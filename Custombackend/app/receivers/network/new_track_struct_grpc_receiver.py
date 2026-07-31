"""TrackManager NewTrackStructStreamService gRPC 客户端（对空/对海融合航迹长连接）。"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import grpc
from loguru import logger

_BRIDGE_DIR = Path(__file__).resolve().parents[2] / "bridge" / "grpc_generated"
if str(_BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(_BRIDGE_DIR))

from target_stream_pb2 import SubscribeNewTrackStructRequest  # noqa: E402
from target_stream_pb2_grpc import NewTrackStructStreamServiceStub  # noqa: E402

from parsers.new_track_struct_grpc_parser import parse_target_output_set_pb  # noqa: E402


class NewTrackStructGrpcReceiver:
    """后台线程订阅 NewTrackStructStreamService.Subscribe 服务端流。"""

    def __init__(
        self,
        config: Dict[str, Any],
        data_callback: Optional[Callable[[List[Dict[str, Any]]], None]] = None,
    ):
        self.config = config
        self.receiver_id = config["id"]
        self.name = config.get("name") or self.receiver_id
        self.host = config["host"]
        self.port = int(config["port"])
        self.reconnect_interval = float(config.get("reconnect_interval", 2.0) or 2.0)
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
            name=f"new-track-struct-grpc-{self.receiver_id}",
            daemon=True,
        )
        self._thread.start()
        logger.info(
            f"✅ NewTrackStruct gRPC 订阅已启动 [{self.receiver_id}] → {self.target}"
        )

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
        backoff_sec = max(0.5, self.reconnect_interval)
        while not self._stop.is_set():
            try:
                self._subscribe_once()
                backoff_sec = max(0.5, self.reconnect_interval)
            except grpc.RpcError as e:
                if self._stop.is_set():
                    break
                logger.warning(
                    f"NewTrackStruct gRPC 流中断 [{self.receiver_id}] {self.target}: "
                    f"{e.code()} {e.details()}"
                )
            except Exception as e:
                if self._stop.is_set():
                    break
                logger.error(
                    f"NewTrackStruct gRPC 订阅异常 [{self.receiver_id}] {self.target}: {e}"
                )
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
        stub = NewTrackStructStreamServiceStub(self._channel)
        # 服务端约 200ms 推一帧；不设短 timeout，由 keepalive / 断线触发重连
        stream = stub.Subscribe(SubscribeNewTrackStructRequest())
        logger.info(f"NewTrackStruct gRPC 已连接 [{self.receiver_id}] {self.target}")
        for resp in stream:
            if self._stop.is_set():
                break
            try:
                tracks = parse_target_output_set_pb(resp)
            except Exception as e:
                logger.error(f"NewTrackStruct gRPC 解析失败 [{self.receiver_id}]: {e}")
                continue
            if tracks is None:
                continue
            if self.data_callback:
                self.data_callback(tracks)
        if self._channel is not None:
            self._channel.close()
            self._channel = None
