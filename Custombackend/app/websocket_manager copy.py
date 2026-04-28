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
        
        self.broadcast_queue: deque = deque()
        self.heartbeat_task: Optional[asyncio.Task] = None
        self.broadcast_task: Optional[asyncio.Task] = None
        
        # 区域数据缓存（WebSocket连接后发送）
        self.area_data: Optional[List[Dict]] = None
    
    def set_area_data(self, data: List[Dict]):
        """设置区域数据"""
        self.area_data = data
    
    async def connect(self, websocket: WebSocket, client_id: Optional[str] = None) -> str:
        """接受WebSocket连接"""
        await websocket.accept()
        
        if not client_id:
            client_id = str(id(websocket))
        
        self.connections[client_id] = websocket
        logger.info(f"WebSocket客户端已连接: {client_id}, 当前连接数: {len(self.connections)}")
        
        # 发送区域数据（Zones）
        if self.area_data:
            zones_message = {
                "type": "Zones",
                "timestamp": datetime.now().isoformat(),
                "data": self.area_data
            }
            await self._send_to_client(client_id, zones_message)
            logger.info(f"✅ 已发送Zones数据到客户端 {client_id}: {len(self.area_data)} 个区域")
        else:
            logger.warning(f"⚠️  没有Zones数据可发送到客户端 {client_id}")
        
        return client_id
    
    def disconnect(self, client_id: str):
        """断开连接"""
        if client_id in self.connections:
            del self.connections[client_id]
            logger.info(f"WebSocket客户端已断开: {client_id}, 当前连接数: {len(self.connections)}")
    
    async def _send_to_client(self, client_id: str, message: Dict[str, Any]) -> bool:
        """发送消息到指定客户端"""
        if client_id not in self.connections:
            return False
        
        try:
            await self.connections[client_id].send_json(message)
            return True
        except Exception as e:
            logger.debug(f"发送消息失败 [{client_id}]: {e}")
            return False
    
    async def broadcast(self, message: Dict[str, Any]):
        """广播消息到所有客户端"""
        disconnected = []
        for client_id, websocket in self.connections.items():
            try:
                await websocket.send_json(message)
            except Exception:
                disconnected.append(client_id)
        
        for client_id in disconnected:
            self.disconnect(client_id)
    
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
        message = {
            "type": "Track",
            "timestamp": datetime.now().isoformat(),
            "data": track_data
        }
        self.broadcast_queue.append(message)
    
    def queue_message(self, message: Dict[str, Any]):
        """将消息加入广播队列"""
        self.broadcast_queue.append(message)
    
    async def _heartbeat_loop(self):
        """心跳循环"""
        while True:
            try:
                await asyncio.sleep(self.heartbeat_interval)
                
                if not self.connections:
                    continue
                
                heartbeat_msg = {
                    "type": "heartbeat",
                    "timestamp": datetime.now().isoformat(),
                    "data": {"message": "ping", "connections": len(self.connections)}
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
        client_id = await self.connect(websocket)
        
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
            pass
        except Exception as e:
            logger.debug(f"WebSocket连接异常: {e}")
        finally:
            self.disconnect(client_id)


# 全局实例
ws_manager = WebSocketManager()
