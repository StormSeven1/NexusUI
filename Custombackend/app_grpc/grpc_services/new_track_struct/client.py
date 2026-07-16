"""gRPC client for TrackManager NewTrackStruct TargetOutputSet stream."""
from __future__ import annotations

import asyncio
from typing import Any, Callable, Dict, Optional

import grpc
from loguru import logger

from grpc_services.new_track_struct.proto_codegen import (
    load_new_track_struct_proto_modules,
)


class NewTrackStructGrpcClient:
    def __init__(
        self,
        config: Dict[str, Any],
        output_callback: Callable[[Any, str], None],
    ) -> None:
        self.id = config.get("id", "new_track_struct_grpc")
        self.name = config.get("name", "NewTrackStruct gRPC")
        self.host = config.get("host") or "127.0.0.1"
        self.port = int(config.get("port") or 60055)
        self.reconnect_interval = float(config.get("reconnect_interval", 2.0))
        self.method = str(config.get("method") or "Subscribe")

        self._output_callback = output_callback
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._channel: Optional[grpc.aio.Channel] = None
        self._pb2 = None
        self._pb2_grpc = None
        self._stub = None

    @property
    def target(self) -> str:
        return f"{self.host}:{self.port}"

    async def start(self) -> None:
        if self._running:
            return
        self._pb2, self._pb2_grpc = load_new_track_struct_proto_modules()
        self._channel = grpc.aio.insecure_channel(
            self.target,
            options=[
                ("grpc.max_receive_message_length", 64 * 1024 * 1024),
                ("grpc.max_send_message_length", 64 * 1024 * 1024),
            ],
        )
        self._stub = self._pb2_grpc.NewTrackStructStreamServiceStub(self._channel)
        self._running = True
        self._task = asyncio.create_task(self._subscribe_loop())
        logger.info(
            "[new-track-struct-grpc] started | id={} target={} method={}",
            self.id,
            self.target,
            self.method,
        )

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        if self._channel:
            await self._channel.close()
            self._channel = None
        logger.info("[new-track-struct-grpc] stopped | id={}", self.id)

    async def _subscribe_loop(self) -> None:
        while self._running:
            try:
                request = self._pb2.SubscribeNewTrackStructRequest()
                subscribe = getattr(self._stub, self.method)
                async for output_set in subscribe(request):
                    try:
                        self._output_callback(output_set, self.id)
                    except Exception as exc:
                        logger.error(
                            "[new-track-struct-grpc] callback failed | id={} error={}",
                            self.id,
                            exc,
                        )
                    if not self._running:
                        break
            except asyncio.CancelledError:
                raise
            except grpc.aio.AioRpcError as exc:
                logger.warning(
                    "[new-track-struct-grpc] stream disconnected | id={} target={} code={} details={}",
                    self.id,
                    self.target,
                    exc.code(),
                    exc.details(),
                )
                await asyncio.sleep(self.reconnect_interval)
            except Exception as exc:
                logger.warning(
                    "[new-track-struct-grpc] stream disconnected | id={} target={} error={}",
                    self.id,
                    self.target,
                    exc,
                )
                await asyncio.sleep(self.reconnect_interval)

