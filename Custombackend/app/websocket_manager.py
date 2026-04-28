"""
WebSocket管理器 - 管理WebSocket连接和消息广播
"""
import asyncio
import json
from typing import Dict, Set, Optional, Any, List
from datetime import datetime
from collections import deque
from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger


class WebSocketManager:
    """WebSocket连接管理器"""
    
    def __init__(self, heartbeat_interval: int = 10, broadcast_interval: int = 500):
        self.connections: Dict[str, WebSocket] = {}
        self.heartbeat_interval = heartbeat_interval
        self.broadcast_interval = broadcast_interval  # 毫秒
        
        # 添加锁保护connections字典
        self._connections_lock = asyncio.Lock()
        
        self.broadcast_queue: deque = deque()
        self.heartbeat_task: Optional[asyncio.Task] = None
        self.broadcast_task: Optional[asyncio.Task] = None
        
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
    
    def disconnect(self, client_id: str):
        """断开连接"""
        async def _disconnect():
            async with self._connections_lock:
                if client_id in self.connections:
                    del self.connections[client_id]
                    logger.info(f"WebSocket客户端已断开: {client_id}, 当前连接数: {len(self.connections)}")
        
        # 如果已经在锁中，直接执行；否则创建任务
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(_disconnect())
            else:
                loop.run_until_complete(_disconnect())
        except:
            # 同步上下文，直接执行
            asyncio.run(_disconnect())
    
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
    
    async def broadcast(self, message: Dict[str, Any]):
        """广播消息到所有客户端"""
        disconnected = []
        # 创建连接的快照，避免在遍历时修改字典
        async with self._connections_lock:
            connections_snapshot = list(self.connections.items())
        
        for client_id, websocket in connections_snapshot:
            try:
                await websocket.send_json(message)
            except Exception as e:
                logger.error(f"broadcast发送消息失败 [{client_id}]: {e}")
                disconnected.append(client_id)
        
        if disconnected:
            logger.info(f"broadcast发现断开的连接: {disconnected}")
        
        for client_id in disconnected:
            logger.info(f"broadcast调用disconnect: {client_id}")
            await self.disconnect(client_id)
    
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
    
    def queue_track_data(self, track_data: Dict[str, Any]):
        """将航迹数据加入广播队列"""
        # 统一添加is_air_track字段
        if 'is_air_track' not in track_data:
            track_data['is_air_track'] = self._determine_air_track(track_data)
        
        message = {
            "type": "Track",
            "timestamp": datetime.now().isoformat(),
            "data": track_data
        }
        self.broadcast_queue.append(message)
    
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
                
                # logger.info(f"广播队列中有 {len(messages)} 个消息待发送")
                # for i, msg in enumerate(messages):
                #     logger.info(f"消息 {i}: type={msg.get('type')}, data类型={type(msg.get('data'))}")
                
                # 分离航迹消息和其他消息
                track_messages = []
                other_messages = []
                for msg in messages:
                    if msg.get("type") == "Track":
                        track_messages.append(msg)
                    else:
                        other_messages.append(msg)
                
                # 批量发送航迹数据
                if track_messages:
                    batch_msg = {
                        "type": "trackBatch",
                        "timestamp": datetime.now().isoformat(),
                        "data": track_messages
                    }
                    await self.broadcast(batch_msg)
                
                # 发送其他消息
                for msg in other_messages:
                    await self.broadcast(msg)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"广播任务出错: {e}")
    
    def start_tasks(self):
        """启动心跳和广播任务"""
        if not self.heartbeat_task or self.heartbeat_task.done():
            self.heartbeat_task = asyncio.create_task(self._heartbeat_loop())
            logger.info(f"心跳任务已启动, 间隔: {self.heartbeat_interval}秒")
        
        if not self.broadcast_task or self.broadcast_task.done():
            self.broadcast_task = asyncio.create_task(self._broadcast_loop())
            logger.info(f"广播任务已启动, 间隔: {self.broadcast_interval}毫秒")
    
    def stop_tasks(self):
        """停止心跳和广播任务"""
        if self.heartbeat_task:
            self.heartbeat_task.cancel()
            self.heartbeat_task = None
        
        if self.broadcast_task:
            self.broadcast_task.cancel()
            self.broadcast_task = None
        
        logger.info("WebSocket任务已停止")
    
    async def handle_connection(self, websocket: WebSocket):
        """处理WebSocket连接"""
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


# 全局实例
ws_manager = WebSocketManager()
