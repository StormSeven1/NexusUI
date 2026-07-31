"""
WebSocket管理器 - 管理WebSocket连接和消息广播

对海融合航迹（fuse_sea）走独立端点 /ws/fuse-sea，避免与其它航迹挤在同一
trackBatch 里导致前端对海融合闪烁。

广播实时性策略（避免拖垮 asyncio 事件循环、同时不加大广播间隔）：
- 序列化用 orjson（释放 GIL）并放到线程池，主循环可继续 accept/HTTP
- 多客户端并行 send；单客户端超时只踢该连接，不阻塞其他前端
"""
import asyncio
import json
from typing import Dict, Set, Optional, Any, List, Callable, Awaitable, Tuple
from datetime import datetime
from collections import deque
from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger

try:
    import orjson

    def _dumps_text(obj: Any) -> str:
        # orjson 输出 bytes；WS 文本帧需要 str。Rust 实现会释放 GIL，减轻卡死。
        return orjson.dumps(obj).decode("utf-8")

except ImportError:  # pragma: no cover

    def _dumps_text(obj: Any) -> str:
        return json.dumps(obj, ensure_ascii=False)

# 与 receiver_manager.TRACK_LAYER_KEY_BY_RECEIVER 中 fuse_sea 对齐
FUSE_SEA_DDS_SOURCE_IDS = frozenset({
    "dds_forward_fuse_track",
    "dds_forward_fuse_track_virtual",
    "grpc_new_track_struct_fuse_sea",
    "grpc_virtual_blue_fuse_sea",
})

# 「状态型」消息：同一目标一拍内只需最新值（前端渲染只用最后一帧，中间值同帧被覆盖）。
# key 为在 data 中取值的字段（按顺序拼接），取到即按此聚合、每拍只留最新。
# 不在此表的类型（如 Alarm 告警、SuspiciousTarget 可疑目标等「事件型」）一律**全部保留**，绝不合并/丢弃。
STATE_COALESCE_KEYS: Dict[str, tuple] = {
    "Camera": ("entityId",),
    "MultiTrackResult": ("cameraId",),
    "SingleTrackResult": ("cameraId",),
    "DockStatus": ("dock_sn",),
    "DroneStatus": ("drone_sn", "track_id"),
    "DroneFlightPath": ("entityId",),
    "DroneTaskStatus": ("entityId",),
    "HighFreq": ("drone_sn", "dock_sn"),
}
# 航迹按此顺序取唯一标识（用于每拍每航迹只留最新的位置快照）
TRACK_ID_KEYS = ("trackId", "track_id", "uniqueId", "unique_id")


def _state_coalesce_key(message: Dict[str, Any]):
    """状态型消息返回 (type, id)；事件型 / 无法识别 id 的返回 None（→ 不合并、全保留）。"""
    fields = STATE_COALESCE_KEYS.get(message.get("type"))
    if not fields:
        return None
    data = message.get("data") or {}
    parts = [str(data.get(f)) for f in fields]
    if all(p == "None" for p in parts):
        return None
    return (message.get("type"), "|".join(parts))


def _track_coalesce_key(message: Dict[str, Any]):
    """航迹唯一标识；取不到返回 None（→ 该航迹一律保留，不参与合并）。"""
    data = message.get("data") or {}
    for k in TRACK_ID_KEYS:
        v = data.get(k)
        if v is not None and v != "":
            return v
    return None


def _coalesce_state_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """对「状态型」消息按目标去重留最新，事件型原样保留；保持原有相对顺序。"""
    output: List[Optional[Dict[str, Any]]] = []
    latest_slot: Dict[Any, int] = {}
    for msg in messages:
        key = _state_coalesce_key(msg)
        if key is None:
            output.append(msg)  # 事件型 / 未知：一条不丢
            continue
        prev = latest_slot.get(key)
        if prev is not None:
            output[prev] = None  # 丢弃同目标较旧的一帧
        latest_slot[key] = len(output)
        output.append(msg)
    return [m for m in output if m is not None]


def _coalesce_track_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """同一航迹一拍内只留最新位置；无法识别 id 的航迹全部保留。"""
    latest: Dict[Any, Dict[str, Any]] = {}
    no_id: List[Dict[str, Any]] = []
    for msg in messages:
        tk = _track_coalesce_key(msg)
        if tk is None:
            no_id.append(msg)
        else:
            latest[tk] = msg
    return list(latest.values()) + no_id


def _prepare_track_batch_payload(track_messages: List[Dict[str, Any]]) -> Optional[str]:
    """在工作线程内：合批去重 + 序列化，避免占满事件循环。"""
    coalesced = _coalesce_track_messages(track_messages)
    if not coalesced:
        return None
    batch_msg = {
        "type": "trackBatch",
        "timestamp": datetime.now().isoformat(),
        "data": coalesced,
    }
    return _dumps_text(batch_msg)


class WebSocketManager:
    """WebSocket连接管理器"""
    
    def __init__(
        self,
        heartbeat_interval: int = 10,
        broadcast_interval: int = 500,
        client_send_timeout_sec: float = 0.15,
    ):
        self.connections: Dict[str, WebSocket] = {}
        self.heartbeat_interval = heartbeat_interval
        self.broadcast_interval = broadcast_interval  # 毫秒
        # 单客户端发送超时：超时只断开该慢连接，健康客户端仍按广播节拍收最新航迹
        self.client_send_timeout_sec = max(0.05, float(client_send_timeout_sec))
        
        # 添加锁保护connections字典
        self._connections_lock = asyncio.Lock()
        
        self.broadcast_queue: deque = deque()
        self.heartbeat_task: Optional[asyncio.Task] = None
        self.broadcast_task: Optional[asyncio.Task] = None

        # 对海融合专用通道（连接 / 队列 / 任务与主 /ws 隔离）
        self.fuse_sea_connections: Dict[str, WebSocket] = {}
        self._fuse_sea_connections_lock = asyncio.Lock()
        self.fuse_sea_queue: deque = deque()
        self.fuse_sea_heartbeat_task: Optional[asyncio.Task] = None
        self.fuse_sea_broadcast_task: Optional[asyncio.Task] = None
        
        # 区域数据缓存（WebSocket连接后发送）
        self.area_data: Optional[List[Dict]] = None
        # 告警方案数据缓存（enabled=true，连接后发送）
        self.schemes_data: Optional[List[Dict]] = None

    def set_area_data(self, data: List[Dict]):
        """设置区域数据"""
        self.area_data = data

    def set_schemes_data(self, data: List[Dict]):
        """设置告警方案数据（来自 alarm_master_schemes，enabled=true）"""
        self.schemes_data = data
    
    async def connect(self, websocket: WebSocket) -> str:
        """建立WebSocket连接"""
        await websocket.accept()
        client_id = str(id(websocket))
        
        async with self._connections_lock:
            self.connections[client_id] = websocket
        
        logger.info(f"WebSocket客户端已连接: {client_id}, 当前连接数: {len(self.connections)}")
        
        # 发送区域数据（如果有）
        if self.area_data:
            zones_message = {
                "type": "Zones",
                "timestamp": datetime.now().isoformat(),
                "data": self.area_data
            }
            logger.info(f"准备发送Zones数据到客户端 {client_id}: {len(self.area_data)} 个区域")
            success = await self._send_to_client(client_id, zones_message)
            if success:
                logger.info(f"✅ 已发送Zones数据到客户端 {client_id}: {len(self.area_data)} 个区域")
            else:
                logger.error(f"❌ 发送Zones数据失败到客户端 {client_id}")
        else:
            logger.warning(f"⚠️  没有Zones数据可发送到客户端 {client_id}")

        # 发送告警方案数据（enabled=true）
        if self.schemes_data:
            schemes_message = {
                "type": "Schemes",
                "timestamp": datetime.now().isoformat(),
                "data": self.schemes_data
            }
            logger.info(f"准备发送Schemes数据到客户端 {client_id}: {len(self.schemes_data)} 个方案")
            success_schemes = await self._send_to_client(client_id, schemes_message)
            if success_schemes:
                logger.info(f"✅ 已发送Schemes数据到客户端 {client_id}")
            else:
                logger.error(f"❌ 发送Schemes数据失败到客户端 {client_id}")
        else:
            logger.warning(f"⚠️  没有Schemes数据可发送到客户端 {client_id}")

        return client_id
    
    async def _remove_client(self, client_id: str) -> None:
        """从连接表移除客户端（须在事件循环内 await）。"""
        async with self._connections_lock:
            if client_id in self.connections:
                del self.connections[client_id]
                logger.info(f"WebSocket客户端已断开: {client_id}, 当前连接数: {len(self.connections)}")

    def disconnect(self, client_id: str) -> None:
        """断开连接（同步入口：在已运行的事件循环中调度 _remove_client）。"""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            asyncio.run(self._remove_client(client_id))
            return
        loop.create_task(self._remove_client(client_id))
    
    async def _send_to_client(self, client_id: str, message: Dict[str, Any]) -> bool:
        """发送消息到指定客户端"""
        async with self._connections_lock:
            if client_id not in self.connections:
                return False
            websocket = self.connections[client_id]
        
        try:
            await websocket.send_json(message)
            return True
        except Exception as e:
            logger.debug(f"发送消息失败 [{client_id}]: {e}")
            return False
    
    async def _fanout_text(
        self,
        connections_snapshot: List[Tuple[str, WebSocket]],
        payload: str,
        *,
        remove_client: Callable[[str], Awaitable[None]],
        log_prefix: str,
    ) -> None:
        """并行推送同一份文本；单客户端超时/失败只踢该连接。"""
        if not connections_snapshot:
            return

        timeout = self.client_send_timeout_sec

        async def _one(client_id: str, websocket: WebSocket) -> Optional[str]:
            try:
                await asyncio.wait_for(websocket.send_text(payload), timeout=timeout)
                return None
            except Exception as e:
                logger.error(f"{log_prefix}失败 [{client_id}]: {e}")
                return client_id

        results = await asyncio.gather(
            *(_one(cid, ws) for cid, ws in connections_snapshot),
            return_exceptions=True,
        )
        disconnected: List[str] = []
        for r in results:
            if isinstance(r, Exception):
                logger.error(f"{log_prefix}内部异常: {r}")
                continue
            if r:
                disconnected.append(r)

        if disconnected:
            logger.info(f"{log_prefix}断开慢/失效连接: {disconnected}")
            for client_id in disconnected:
                await remove_client(client_id)

    async def broadcast(self, message: Dict[str, Any]):
        """广播消息到所有客户端"""
        async with self._connections_lock:
            connections_snapshot = list(self.connections.items())
        if not connections_snapshot:
            return

        # 序列化放到线程池，避免大 trackBatch 同步 dumps 饿死事件循环
        payload = await asyncio.to_thread(_dumps_text, message)
        await self._fanout_text(
            connections_snapshot,
            payload,
            remove_client=self._remove_client,
            log_prefix="broadcast发送消息",
        )

    async def broadcast_text(self, payload: str):
        """已序列化好的文本直接扇出（航迹合批路径用）。"""
        async with self._connections_lock:
            connections_snapshot = list(self.connections.items())
        await self._fanout_text(
            connections_snapshot,
            payload,
            remove_client=self._remove_client,
            log_prefix="broadcast发送消息",
        )
    
    async def broadcast_command(self, command: Dict[str, Any]):
        """广播地图指令到所有客户端（MCP服务使用）"""
        if not self.connections:
            logger.warning("[MCP] 没有活跃的WebSocket连接")
            return
        
        message = {
            "type": "map_command",
            "timestamp": datetime.now().isoformat(),
            "data": command
        }
        await self.broadcast(message)
        logger.info(f"[MCP] 已广播地图指令: {command.get('command', 'unknown')}")
    
    @staticmethod
    def _is_fuse_sea_track(track_data: Dict[str, Any]) -> bool:
        """判断是否为对海融合航迹（走 /ws/fuse-sea，不进主 /ws 的 trackBatch）。"""
        tlk = str(track_data.get("track_layer_key", "") or "").strip().lower().replace("-", "_")
        if tlk == "fuse_sea":
            return True
        dds = str(track_data.get("dds_source_id", "") or "").strip().lower()
        return dds in FUSE_SEA_DDS_SOURCE_IDS

    def queue_track_data(self, track_data: Dict[str, Any]):
        """将航迹数据加入广播队列（对海融合进独立队列）。"""
        embedded_alarms = track_data.pop('embedded_alarms', None)
        # 后端接收时刻（epoch ms）：所有航迹源统一在此汇聚点打点，供前端标牌对比
        # 「gRPC/DDS 原始时间 → 后端接收 → 前端接收」三段时延。
        if 'backend_recv_ms' not in track_data:
            track_data['backend_recv_ms'] = int(datetime.now().timestamp() * 1000)
        # 统一添加is_air_track字段
        if 'is_air_track' not in track_data:
            track_data['is_air_track'] = self._determine_air_track(track_data)
        # DDS 的 source_name 常不含「对空」→ 上面会全判对海；按接收器写入的 layer / dds id 校正
        self._sync_is_air_track_from_dds_layer(track_data)

        try:
            from radar_train.service import process_fuse_air_track
            process_fuse_air_track(track_data)
        except Exception as e:
            logger.debug("雷达训练真值采集跳过: {}", e)

        # 航迹链路评估旁路：无活跃任务时立即返回；有任务时仅非阻塞入队，独立线程处理
        try:
            from track_link_evaluator import feed_track_link_evaluator
            feed_track_link_evaluator(track_data)
        except Exception:
            pass

        message = {
            "type": "Track",
            "timestamp": datetime.now().isoformat(),
            "data": track_data
        }
        if self._is_fuse_sea_track(track_data):
            self.fuse_sea_queue.append(message)
        else:
            self.broadcast_queue.append(message)

        # 嵌入告警仍走主通道（告警/处置不依赖对海专用 WS）
        if embedded_alarms:
            for alarm_item in embedded_alarms:
                if not isinstance(alarm_item, dict):
                    continue
                self.queue_message({
                    "type": "Alarm",
                    "timestamp": datetime.now().isoformat(),
                    "data": alarm_item,
                })
    
    def _determine_air_track(self, track_data: Dict[str, Any]) -> bool:
        """
        简化的对空航迹判断逻辑：只判断对空，其他都是对海
        
        Args:
            track_data: 航迹数据
            
        Returns:
            True-对空航迹，False-对海航迹
        """
        # 检查数据源名称中是否包含对空关键词
        source_name = track_data.get('source_name', '')
        
        # 对空关键词
        air_keywords = ['对空', '无人机', '自报位', '机场']
        
        # 只要包含任何一个对空关键词，就是对空航迹
        for keyword in air_keywords:
            if keyword in source_name:
                return True
        
        # 其他都是对海航迹
        return False

    def _sync_is_air_track_from_dds_layer(self, track_data: Dict[str, Any]) -> None:
        """
        与 NexusUI `TRACK_LAYER_KEY_BY_DDS_SOURCE_ID` 一致：用 track_layer_key / dds_source_id
        区分对空融合、探鸟与对海/雷达，避免仅靠 source_name 导致全为对海、前端全画船标。
        """
        tlk = str(track_data.get("track_layer_key", "") or "").strip().lower().replace("-", "_")
        if tlk in ("fuse_air", "bird_radar", "auto_bird_radar", "fanwu_car_radar", "uav_pose_track"):
            track_data["is_air_track"] = True
        elif tlk in ("fuse_sea", "radar_wharf", "radar_jingzi", "ais_track", "boat_self_track", "xpf_track"):
            track_data["is_air_track"] = False

        dds = str(track_data.get("dds_source_id", "") or "").strip().lower()
        if dds in (
            "dds_forward_fuse_bird_radar_track",
            "dds_forward_bird_radar_track",
            "grpc_fusion_track_bird",
            "udp_auto_bird_radar",
            "dds_forward_auto_bird_radar_track",
            "grpc_fusion_track_auto_bird",
            "dds_forward_fanwu_car_track",
            "dds_udp_fanwucar_track",
            "grpc_fusion_track_fanwu",
            "grpc_fusion_track_ku",
            "dds_forward_uav_pose_track",
            "grpc_fusion_track_uav_pose",
        ):
            track_data["is_air_track"] = True
        elif dds in (
            "dds_forward_fuse_track",
            "dds_forward_radar_track1",
            "dds_forward_radar_track2",
            "dds_forward_ais_track",
            "grpc_fusion_track_ais",
            "grpc_fusion_track_radar_wharf",
            "grpc_fusion_track_radar_jingzi",
            "grpc_fusion_track_xpf",
            "grpc_fusion_track_boatself",
            "dds_udp_boatself_track",
            "dds_udp_xpf_track",
        ):
            track_data["is_air_track"] = False

    def queue_message(self, message: Dict[str, Any]):
        """将消息加入广播队列"""
        self.broadcast_queue.append(message)
    
    async def _heartbeat_loop(self):
        """心跳循环"""
        while True:
            try:
                await asyncio.sleep(self.heartbeat_interval)
                
                async with self._connections_lock:
                    if not self.connections:
                        continue
                    connection_count = len(self.connections)
                
                heartbeat_msg = {
                    "type": "heartbeat",
                    "timestamp": datetime.now().isoformat(),
                    "data": {"message": "ping", "connections": connection_count}
                }
                await self.broadcast(heartbeat_msg)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"心跳任务出错: {e}")
    
    async def _broadcast_loop(self):
        """广播循环 - 批量发送队列中的消息"""
        while True:
            try:
                await asyncio.sleep(self.broadcast_interval / 1000)
                
                async with self._connections_lock:
                    if not self.connections:
                        self.broadcast_queue.clear()
                        continue
                
                if not self.broadcast_queue:
                    continue
                
                # 取出所有消息
                messages = []
                while self.broadcast_queue:
                    messages.append(self.broadcast_queue.popleft())
                
                # 分离航迹消息和其他消息
                track_messages = []
                other_messages = []
                for msg in messages:
                    if msg.get("type") == "Track":
                        track_messages.append(msg)
                    else:
                        other_messages.append(msg)

                # 航迹：线程内 coalesce + dumps，保持 100ms 节拍且不堵事件循环
                if track_messages:
                    payload = await asyncio.to_thread(
                        _prepare_track_batch_payload, track_messages
                    )
                    if payload:
                        await self.broadcast_text(payload)

                # 其他：状态型按目标去重留最新，事件型（告警等）全部保留
                other_messages = _coalesce_state_messages(other_messages)
                if other_messages:
                    # 1次线程调用批量序列化，避免N次to_thread开销拖慢事件循环
                    other_payloads: List[str] = await asyncio.to_thread(
                        lambda msgs=other_messages: [_dumps_text(m) for m in msgs]
                    )
                    # 复用同一连接快照，避免N次锁竞争
                    async with self._connections_lock:
                        other_conns = list(self.connections.items())
                    if other_conns:
                        for payload in other_payloads:
                            await self._fanout_text(
                                other_conns,
                                payload,
                                remove_client=self._remove_client,
                                log_prefix="broadcast发送消息",
                            )
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"广播任务出错: {e}")

    async def connect_fuse_sea(self, websocket: WebSocket) -> str:
        """建立对海融合专用 WebSocket（不推 Zones/Schemes）。"""
        await websocket.accept()
        client_id = str(id(websocket))
        async with self._fuse_sea_connections_lock:
            self.fuse_sea_connections[client_id] = websocket
        logger.info(
            f"对海融合 WS 客户端已连接: {client_id}, 当前连接数: {len(self.fuse_sea_connections)}"
        )
        return client_id

    async def _remove_fuse_sea_client(self, client_id: str) -> None:
        async with self._fuse_sea_connections_lock:
            if client_id in self.fuse_sea_connections:
                del self.fuse_sea_connections[client_id]
                logger.info(
                    f"对海融合 WS 客户端已断开: {client_id}, 当前连接数: {len(self.fuse_sea_connections)}"
                )

    def disconnect_fuse_sea(self, client_id: str) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            asyncio.run(self._remove_fuse_sea_client(client_id))
            return
        loop.create_task(self._remove_fuse_sea_client(client_id))

    async def _send_to_fuse_sea_client(self, client_id: str, message: Dict[str, Any]) -> bool:
        async with self._fuse_sea_connections_lock:
            if client_id not in self.fuse_sea_connections:
                return False
            websocket = self.fuse_sea_connections[client_id]
        try:
            await websocket.send_json(message)
            return True
        except Exception as e:
            logger.debug(f"对海融合 WS 发送失败 [{client_id}]: {e}")
            return False

    async def broadcast_fuse_sea(self, message: Dict[str, Any]):
        async with self._fuse_sea_connections_lock:
            connections_snapshot = list(self.fuse_sea_connections.items())
        if not connections_snapshot:
            return
        payload = await asyncio.to_thread(_dumps_text, message)
        await self._fanout_text(
            connections_snapshot,
            payload,
            remove_client=self._remove_fuse_sea_client,
            log_prefix="对海融合 broadcast",
        )

    async def broadcast_fuse_sea_text(self, payload: str):
        async with self._fuse_sea_connections_lock:
            connections_snapshot = list(self.fuse_sea_connections.items())
        await self._fanout_text(
            connections_snapshot,
            payload,
            remove_client=self._remove_fuse_sea_client,
            log_prefix="对海融合 broadcast",
        )

    async def _fuse_sea_heartbeat_loop(self):
        while True:
            try:
                await asyncio.sleep(self.heartbeat_interval)
                async with self._fuse_sea_connections_lock:
                    if not self.fuse_sea_connections:
                        continue
                    connection_count = len(self.fuse_sea_connections)
                heartbeat_msg = {
                    "type": "heartbeat",
                    "timestamp": datetime.now().isoformat(),
                    "data": {
                        "message": "ping",
                        "channel": "fuse_sea",
                        "connections": connection_count,
                    },
                }
                await self.broadcast_fuse_sea(heartbeat_msg)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"对海融合心跳任务出错: {e}")

    async def _fuse_sea_broadcast_loop(self):
        """对海融合专用广播：仅 trackBatch。"""
        while True:
            try:
                await asyncio.sleep(self.broadcast_interval / 1000)

                async with self._fuse_sea_connections_lock:
                    if not self.fuse_sea_connections:
                        self.fuse_sea_queue.clear()
                        continue

                if not self.fuse_sea_queue:
                    continue

                track_messages = []
                while self.fuse_sea_queue:
                    msg = self.fuse_sea_queue.popleft()
                    if msg.get("type") == "Track":
                        track_messages.append(msg)

                if track_messages:
                    payload = await asyncio.to_thread(
                        _prepare_track_batch_payload, track_messages
                    )
                    if payload:
                        await self.broadcast_fuse_sea_text(payload)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"对海融合广播任务出错: {e}")
    
    def start_tasks(self):
        """启动心跳和广播任务"""
        if not self.heartbeat_task or self.heartbeat_task.done():
            self.heartbeat_task = asyncio.create_task(self._heartbeat_loop())
            logger.info(f"心跳任务已启动, 间隔: {self.heartbeat_interval}秒")
        
        if not self.broadcast_task or self.broadcast_task.done():
            self.broadcast_task = asyncio.create_task(self._broadcast_loop())
            logger.info(f"广播任务已启动, 间隔: {self.broadcast_interval}毫秒")

        if not self.fuse_sea_heartbeat_task or self.fuse_sea_heartbeat_task.done():
            self.fuse_sea_heartbeat_task = asyncio.create_task(self._fuse_sea_heartbeat_loop())
            logger.info(f"对海融合心跳已启动, 间隔: {self.heartbeat_interval}秒")

        if not self.fuse_sea_broadcast_task or self.fuse_sea_broadcast_task.done():
            self.fuse_sea_broadcast_task = asyncio.create_task(self._fuse_sea_broadcast_loop())
            logger.info(f"对海融合广播已启动, 间隔: {self.broadcast_interval}毫秒")
    
    def stop_tasks(self):
        """停止心跳和广播任务"""
        if self.heartbeat_task:
            self.heartbeat_task.cancel()
            self.heartbeat_task = None
        
        if self.broadcast_task:
            self.broadcast_task.cancel()
            self.broadcast_task = None

        if self.fuse_sea_heartbeat_task:
            self.fuse_sea_heartbeat_task.cancel()
            self.fuse_sea_heartbeat_task = None

        if self.fuse_sea_broadcast_task:
            self.fuse_sea_broadcast_task.cancel()
            self.fuse_sea_broadcast_task = None
        
        logger.info("WebSocket任务已停止")
    
    async def handle_connection(self, websocket: WebSocket):
        """处理主 WebSocket 连接（/ws）"""
        logger.info("handle_connection开始执行")
        client_id = await self.connect(websocket)
        logger.info(f"connect返回client_id: {client_id}, 开始while循环")
        
        try:
            while True:
                try:
                    data = await websocket.receive_text()
                    message = json.loads(data)
                    msg_type = message.get("type", "")
                    
                    if msg_type == "ping":
                        await self._send_to_client(client_id, {
                            "type": "pong",
                            "timestamp": datetime.now().isoformat(),
                            "data": {"message": "pong"}
                        })
                    elif msg_type == "pong":
                        pass  # 客户端响应心跳
                    else:
                        logger.debug(f"收到未知消息类型: {msg_type}")
                        
                except json.JSONDecodeError:
                    logger.warning(f"无法解析消息: {data}")
                    
        except WebSocketDisconnect:
            logger.info(f"客户端主动断开连接: {client_id}")
        except Exception as e:
            logger.error(f"WebSocket连接异常 [{client_id}]: {e}")
            logger.error(f"异常类型: {type(e).__name__}")
            import traceback
            logger.error(f"异常堆栈: {traceback.format_exc()}")
        finally:
            logger.info(f"WebSocket连接处理结束，断开客户端: {client_id}")
            self.disconnect(client_id)

    async def handle_fuse_sea_connection(self, websocket: WebSocket):
        """处理对海融合专用 WebSocket（/ws/fuse-sea）"""
        client_id = await self.connect_fuse_sea(websocket)
        try:
            while True:
                try:
                    data = await websocket.receive_text()
                    message = json.loads(data)
                    msg_type = message.get("type", "")
                    if msg_type == "ping":
                        await self._send_to_fuse_sea_client(client_id, {
                            "type": "pong",
                            "timestamp": datetime.now().isoformat(),
                            "data": {"message": "pong", "channel": "fuse_sea"},
                        })
                    elif msg_type == "pong":
                        pass
                    else:
                        logger.debug(f"对海融合 WS 未知消息类型: {msg_type}")
                except json.JSONDecodeError:
                    logger.warning(f"对海融合 WS 无法解析消息: {data}")
        except WebSocketDisconnect:
            logger.info(f"对海融合客户端主动断开: {client_id}")
        except Exception as e:
            logger.error(f"对海融合 WebSocket 异常 [{client_id}]: {e}")
            import traceback
            logger.error(traceback.format_exc())
        finally:
            self.disconnect_fuse_sea(client_id)


# 全局实例
ws_manager = WebSocketManager()
