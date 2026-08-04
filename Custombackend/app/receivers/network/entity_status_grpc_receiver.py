"""EntityStatusService gRPC 客户端（订阅无人机自报位/任务/高频）。"""
from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional

import grpc
from loguru import logger


def _hf_min_interval_ms() -> float:
    """高频帧「解析前按机限频」最小间隔（ms）。

    源端高频常达 ~50Hz/机，而地图渲染 + WS 广播（100ms）只用到 ~10Hz。
    后端为单 Python 进程、GIL 受限；若逐帧全量解析 50Hz×多机，会把接收线程
    的 GIL 时间耗尽 → 消费慢于生产 → gRPC 缓冲越积越多 → 高频坐标滞后数十秒
    （表现为「三角坐标在动但严重落后融合/自报位航迹，偶尔重连冲掉缓冲才短暂正常」）。
    这里在**解析前**按 entity 限频丢弃多余帧：被丢帧仅做 C 层字段读取、几乎零耗时，
    使 for 循环能全速把 socket/缓冲排空，重解析只按 ~20Hz 进行，坐标恒为最新。
    默认 50ms（≈20Hz），留足广播 10Hz 的余量；置 0 关闭限频。
    """
    try:
        return max(0.0, float(os.getenv("NEXUS_ENTITY_HIGH_FREQ_MIN_INTERVAL_MS", "50")))
    except (TypeError, ValueError):
        return 50.0

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
        # 高频「解析前按机限频」：entity_id -> 上次放行时刻(ms)
        self._hf_min_interval_ms = _hf_min_interval_ms()
        self._hf_last_pass_ms: Dict[str, float] = {}
        self._hf_dropped = 0

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

    def _should_drop_high_freq(self, resp) -> bool:
        """仅对高频帧按 entity 限频：距上次放行不足最小间隔则丢弃（True）。

        非高频帧（相机/自报位/任务）一律放行；字段读取走 protobuf C 层，开销极低。
        """
        if resp.WhichOneof("status") != "high_freq_real_time_status":
            return False
        hf = resp.high_freq_real_time_status
        eid = hf.base.entity_id or hf.drone_sn or ""
        now_ms = time.monotonic() * 1000.0
        last = self._hf_last_pass_ms.get(eid, 0.0)
        if now_ms - last < self._hf_min_interval_ms:
            self._hf_dropped += 1
            return True
        self._hf_last_pass_ms[eid] = now_ms
        return False

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
        # 重连后清空限频窗口，避免用旧时刻误丢首帧
        self._hf_last_pass_ms.clear()
        logger.info(f"EntityStatus gRPC 已连接 [{self.receiver_id}] {self.target}")
        for resp in stream:
            if self._stop.is_set():
                break
            # 解析前限频：仅对高频帧做 C 层轻量判断，超频者直接丢弃（latest-wins），
            # 避免全量 Python 解析拖慢消费、造成 gRPC 缓冲积压与坐标滞后。
            if self._hf_min_interval_ms > 0.0 and self._should_drop_high_freq(resp):
                continue
            parsed = parse_entity_status_response(resp, source_id=self.receiver_id)
            if parsed and self.data_callback:
                self.data_callback(parsed)
        if self._channel is not None:
            self._channel.close()
            self._channel = None
