"""FusionTrack gRPC 客户端（:60056 统一航迹流；摄入远遥/靖子头/鹏飞/船自报位）。

服务：trackmanager.grpc.fusion_track.FusionTrackStreamService/Subscribe
响应：服务端流式 TrackDataClassBatch（tracks[i] 与 sources[i] 按下标对应，约 0.2s 一帧）。
无心跳；无数据时保持等待，由 keepalive / 断线触发重连（与 NewTrackStructGrpcReceiver 一致）。
"""
from __future__ import annotations

import sys
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import grpc
from loguru import logger

_BRIDGE_DIR = Path(__file__).resolve().parents[2] / "bridge" / "grpc_generated"
if str(_BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(_BRIDGE_DIR))

from fusion_track_stream_pb2 import SubscribeFusionTrackRequest  # noqa: E402
from fusion_track_stream_pb2_grpc import FusionTrackStreamServiceStub  # noqa: E402

from parsers.fusion_track_grpc_parser import track_data_class_to_radar_track  # noqa: E402


class FusionTrackGrpcReceiver:
    """后台线程订阅 FusionTrackStreamService.Subscribe 服务端流。"""

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
            name=f"fusion-track-grpc-{self.receiver_id}",
            daemon=True,
        )
        self._thread.start()
        logger.info(
            f"✅ FusionTrack gRPC 订阅已启动 [{self.receiver_id}] → {self.target}"
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
                    f"FusionTrack gRPC 流中断 [{self.receiver_id}] {self.target}: "
                    f"{e.code()} {e.details()}"
                )
            except Exception as e:
                if self._stop.is_set():
                    break
                logger.error(
                    f"FusionTrack gRPC 订阅异常 [{self.receiver_id}] {self.target}: {e}"
                )
            if self._stop.wait(backoff_sec):
                break
            backoff_sec = min(backoff_sec * 2, 30.0)

    def _subscribe_once(self) -> None:
        options = [
            ("grpc.max_receive_message_length", 64 * 1024 * 1024),
            ("grpc.keepalive_time_ms", 10000),
            ("grpc.keepalive_timeout_ms", 5000),
            ("grpc.keepalive_permit_without_calls", 1),
        ]
        self._channel = grpc.insecure_channel(self.target, options=options)
        grpc.channel_ready_future(self._channel).result(timeout=10)
        stub = FusionTrackStreamServiceStub(self._channel)
        stream = stub.Subscribe(SubscribeFusionTrackRequest())
        logger.info(f"FusionTrack gRPC 已连接 [{self.receiver_id}] {self.target}")
        for batch in stream:
            if self._stop.is_set():
                break
            tracks = getattr(batch, "tracks", None)
            sources = getattr(batch, "sources", None)
            if not tracks:
                continue
            parsed: List[Dict[str, Any]] = []
            for i, track in enumerate(tracks):
                source = sources[i] if sources is not None and i < len(sources) else None
                row = track_data_class_to_radar_track(track, source)
                if row is not None:  # 非旁路源返回 None，跳过（防与 DDS/:60055 重复）
                    parsed.append(row)
            if parsed and self.data_callback:
                self.data_callback(parsed)
        if self._channel is not None:
            self._channel.close()
            self._channel = None
