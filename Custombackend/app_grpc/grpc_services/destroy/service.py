"""
Destroy gRPC 服务。

设计保持尽量直接：
1. HTTP `/api/destroy/publish` 收到一次请求，就广播一次 DestroyEvent。
2. 外部系统作为 gRPC 客户端调用 `SubscribeDestroyEvents` 建立长连接。
3. HTTP 响应里返回当前在线 gRPC 客户端数量，便于前端确认是否有人在收。
"""

from __future__ import annotations

import asyncio
import uuid

import grpc
from loguru import logger

from grpc_services.destroy.proto_codegen import load_destroy_proto_modules


class DestroyEventBroadcaster:
    """维护所有订阅中的客户端队列，并负责广播 destroy 事件。"""

    def __init__(self) -> None:
        self._subscribers: dict[str, dict[str, object]] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _extract_client_ip(peer: str | None) -> str:
        """从 gRPC peer 字符串中提取客户端地址。"""
        if not peer:
            return "unknown"
        if peer.startswith("ipv4:") or peer.startswith("ipv6:"):
            return peer.split(":", 1)[1]
        return peer

    async def add_subscriber(self, peer: str | None = None) -> tuple[str, asyncio.Queue]:
        """注册一个新的订阅客户端，并返回其专属队列。"""
        subscriber_id = uuid.uuid4().hex
        queue: asyncio.Queue = asyncio.Queue()
        client_ip = self._extract_client_ip(peer)
        async with self._lock:
            self._subscribers[subscriber_id] = {
                "queue": queue,
                "client_ip": client_ip,
            }
            count = len(self._subscribers)
        logger.info(
            f"[destroy-grpc] subscriber connected: {subscriber_id}, client_ip={client_ip}, connected_clients={count}"
        )
        return subscriber_id, queue

    async def remove_subscriber(self, subscriber_id: str) -> None:
        """客户端断开时从订阅列表中移除，避免在线数虚高。"""
        async with self._lock:
            subscriber = self._subscribers.pop(subscriber_id, None)
            count = len(self._subscribers)
        client_ip = (
            str(subscriber.get("client_ip", "unknown"))
            if isinstance(subscriber, dict)
            else "unknown"
        )
        logger.info(
            f"[destroy-grpc] subscriber disconnected: {subscriber_id}, client_ip={client_ip}, connected_clients={count}"
        )

    async def connected_clients(self) -> int:
        """返回当前在线的 gRPC 订阅客户端数量。"""
        async with self._lock:
            return len(self._subscribers)

    async def publish(self, event) -> int:
        """向当前所有在线订阅客户端广播一条 destroy 事件，并返回在线数量。"""
        async with self._lock:
            queues = [
                subscriber["queue"]
                for subscriber in self._subscribers.values()
                if isinstance(subscriber, dict) and "queue" in subscriber
            ]
            count = len(queues)
        for queue in queues:
            await queue.put(event)
        return count


class DestroyGrpcService:
    """封装 destroy gRPC server 的启动、停止、广播和在线数统计。"""

    def __init__(self) -> None:
        self._pb2 = None
        self._pb2_grpc = None
        self._server: grpc.aio.Server | None = None
        self._listen_address: str | None = None
        self._broadcaster = DestroyEventBroadcaster()

    def _ensure_proto_modules(self) -> None:
        if self._pb2 is not None and self._pb2_grpc is not None:
            return
        self._pb2, self._pb2_grpc = load_destroy_proto_modules()

    async def start(self, host: str, port: int) -> None:
        """启动 destroy gRPC server。"""
        if self._server is not None:
            return

        self._ensure_proto_modules()
        self._server = grpc.aio.server()
        self._listen_address = f"{host}:{port}"
        servicer = self._build_servicer()
        self._pb2_grpc.add_DestroyEventServiceServicer_to_server(servicer, self._server)
        self._server.add_insecure_port(self._listen_address)
        await self._server.start()
        logger.info(f"[destroy-grpc] server started at {self._listen_address}")

    async def stop(self) -> None:
        """停止 destroy gRPC server。"""
        if self._server is None:
            return
        await self._server.stop(grace=3)
        logger.info("[destroy-grpc] server stopped")
        self._server = None

    async def connected_clients(self) -> int:
        """返回当前在线的 destroy gRPC 客户端数。"""
        return await self._broadcaster.connected_clients()

    async def publish_destroy_event(self, payload: dict) -> int:
        """把 HTTP body 映射为 proto 消息，并广播给所有在线客户端。"""
        self._ensure_proto_modules()
        event = self._pb2.DestroyEvent(
            task_id=str(payload.get("task_id", "")),
            parent_task_id=str(payload.get("parent_task_id", "")),
            version=self._pb2.DestroyVersion(
                definition_version=int(payload.get("version_definition_version", 0)),
                status_version=int(payload.get("version_status_version", 0)),
            ),
            display_name=str(payload.get("display_name", "")),
            task_type=str(payload.get("task_type", "")),
            max_execution_time_ms=int(payload.get("max_execution_time_ms", 0)),
            specification=self._pb2.DestroySpecification(
                at_type=str(payload.get("specification_at_type", "")),
                type=int(payload.get("specification_type", 0)),
                id=str(payload.get("specification_id", "")),
            ),
            created_by=self._pb2.DestroyCreatedBy(
                system=self._pb2.DestroyCreatedBySystem(
                    service_name=str(payload.get("created_by_service_name", "")),
                    entity_id=str(payload.get("created_by_entity_id", "")),
                    manages_own_scheduling=bool(payload.get("created_by_manages_own_scheduling", False)),
                    priority=int(payload.get("created_by_priority", 0)),
                )
            ),
            owner=self._pb2.DestroyOwner(
                entity_id=str(payload.get("owner_entity_id", "")),
            ),
        )
        connected = await self._broadcaster.publish(event)
        logger.info(
            "[destroy-grpc] published destroy event: "
            f"task_id={payload.get('task_id', '')}, connected_clients={connected}"
        )
        return connected

    async def publish_destroy_http_body(self, body: dict) -> int:
        """Publish a destroy event from the same JSON shape used by HTTP."""
        if not isinstance(body, dict):
            raise ValueError("destroy payload must be a JSON object")

        version = body.get("version") or {}
        specification = body.get("specification") or {}
        created_by = body.get("createdBy") or {}
        created_by_system = created_by.get("system") if isinstance(created_by, dict) else {}
        owner = body.get("owner") or {}

        if not isinstance(version, dict):
            version = {}
        if not isinstance(specification, dict):
            specification = {}
        if not isinstance(created_by_system, dict):
            created_by_system = {}
        if not isinstance(owner, dict):
            owner = {}

        return await self.publish_destroy_event(
            {
                "task_id": body.get("taskId", ""),
                "parent_task_id": body.get("parentTaskId", ""),
                "version_definition_version": version.get("definitionVersion", 0),
                "version_status_version": version.get("statusVersion", 0),
                "display_name": body.get("displayName", ""),
                "task_type": body.get("taskType", ""),
                "max_execution_time_ms": body.get("maxExecutionTimeMs", 0),
                "specification_at_type": specification.get("@type", ""),
                "specification_type": specification.get("type", 0),
                "specification_id": specification.get("id", ""),
                "created_by_service_name": created_by_system.get("serviceName", ""),
                "created_by_entity_id": created_by_system.get("entityId", ""),
                "created_by_manages_own_scheduling": created_by_system.get("managesOwnScheduling", False),
                "created_by_priority": created_by_system.get("priority", 0),
                "owner_entity_id": owner.get("entityId", ""),
            }
        )

    def _build_servicer(self):
        """创建真正挂到 gRPC server 上的 servicer。"""
        broadcaster = self._broadcaster
        pb2_grpc = self._pb2_grpc

        class DestroyEventServicer(pb2_grpc.DestroyEventServiceServicer):
            async def SubscribeDestroyEvents(self, request, context):
                """
                为每个客户端维持一条独立流。

                这里不做复杂过滤，谁连上来就收到后续所有 destroy 事件。
                """
                peer = context.peer() if context else None
                client_ip = broadcaster._extract_client_ip(peer)
                subscriber_id, queue = await broadcaster.add_subscriber(peer)
                try:
                    while True:
                        event = await queue.get()
                        yield event
                except asyncio.CancelledError:
                    logger.info(
                        f"[destroy-grpc] stream cancelled: {subscriber_id}, client_ip={client_ip}"
                    )
                    raise
                finally:
                    await broadcaster.remove_subscriber(subscriber_id)

        return DestroyEventServicer()


destroy_grpc_service = DestroyGrpcService()
