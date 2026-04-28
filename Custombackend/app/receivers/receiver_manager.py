"""
接收器管理器 - 统一管理所有数据接收器
"""
import asyncio
from typing import Dict, List, Optional, Any
from loguru import logger

from receivers.network import (
    UDPReceiver,
    TCPClient,
    MQTTReceiver,
    HTTPPoller,
    DDSReceiverService,
    DDS_AVAILABLE
)
from parsers import TrackParser
from parsers.entity_parser import parse_entity_status
from websocket_manager import ws_manager

# DDS接收器（可选）- 使用动态DDS接收器服务
if not DDS_AVAILABLE:
    logger.warning("DDS功能不可用（FastDDS库未安装或模块未找到）")


class ReceiverManager:
    """接收器管理器"""
    
    def __init__(self, local_interface: str = "0.0.0.0"):
        self.local_interface = local_interface
        
        # 接收器实例
        self.udp_receivers: Dict[str, UDPReceiver] = {}
        self.tcp_clients: Dict[str, TCPClient] = {}
        self.http_pollers: Dict[str, HTTPPoller] = {}
        self.mqtt_receivers: Dict[str, MQTTReceiver] = {}
        self.dds_receivers: Dict[str, Any] = {}  # DDSReceiver实例
        
        # 统计信息
        self._stats: Dict[str, Dict[str, int]] = {}
    
    def _init_stats(self, receiver_id: str):
        """初始化统计信息"""
        if receiver_id not in self._stats:
            self._stats[receiver_id] = {
                'received': 0,
                'parsed': 0,
                'failed': 0
            }
    
    def _on_udp_data(self, data: bytes, addr: tuple, receiver_id: str):
        """UDP数据回调"""
        self._init_stats(receiver_id)
        self._stats[receiver_id]['received'] += 1
        
        # 获取数据格式和名称
        receiver = self.udp_receivers.get(receiver_id)
        data_format = receiver.data_format if receiver else 'FusionTrack'
        source_name = receiver.name if receiver and receiver.name else 'UDP数据源'

        # 虚兵航迹 / 虚兵任务：二进制或 JSON，直接转发为 DroneStatus + HighFreq 或 DroneFlightPath
        if data_format == 'VirtualUnitTrack':
            from parsers.virtual_unit_udp import parse_virtual_unit_track
            messages = parse_virtual_unit_track(data)
            if messages:
                for msg in messages:
                    payload = msg.get('data')
                    if isinstance(payload, dict):
                        payload['source_name'] = source_name
                    ws_manager.queue_message(msg)
                self._stats[receiver_id]['parsed'] += len(messages)
            else:
                self._stats[receiver_id]['failed'] += 1
            return

        if data_format == 'VirtualUnitDroneTask':
            from parsers.virtual_unit_udp import parse_virtual_unit_drone_task
            msg = parse_virtual_unit_drone_task(data)
            if msg:
                payload = msg.get('data')
                if isinstance(payload, dict):
                    payload['source_name'] = source_name
                ws_manager.queue_message(msg)
                self._stats[receiver_id]['parsed'] += 1
            else:
                self._stats[receiver_id]['failed'] += 1
            return
        
        # 解析数据
        tracks = TrackParser.parse(data, data_format, receiver_id)
        if tracks:
            self._stats[receiver_id]['parsed'] += len(tracks)
            for track in tracks:
                # 统一添加source_name字段
                track['source_name'] = source_name
                ws_manager.queue_track_data(track)
        else:
            self._stats[receiver_id]['failed'] += 1
    
    def _on_tcp_data(self, data: bytes, client_id: str):
        """TCP数据回调"""
        self._init_stats(client_id)
        self._stats[client_id]['received'] += 1
        
        client = self.tcp_clients.get(client_id)
        data_format = client.data_format if client else 'FusionTrack'
        source_name = client.name
        
        tracks = TrackParser.parse(data, data_format, client_id)
        if tracks:
            self._stats[client_id]['parsed'] += len(tracks)
            for track in tracks:
                # 统一添加source_name字段
                track['source_name'] = source_name
                ws_manager.queue_track_data(track)
        else:
            self._stats[client_id]['failed'] += 1
    
    def _create_mqtt_callback(self, receiver_id: str):
        """创建MQTT数据回调（闭包，绑定receiver_id）"""
        def callback(data: bytes, topic: str, _receiver_id: str):
            self._init_stats(receiver_id)
            self._stats[receiver_id]['received'] += 1
            
            # 获取接收器和数据格式
            mqtt_receiver = self.mqtt_receivers.get(receiver_id)
            source_name = mqtt_receiver.name if mqtt_receiver and mqtt_receiver.name else 'MQTT数据源'
            
            data_format = 'JSON'
            if mqtt_receiver:
                for topic_config in mqtt_receiver.topics:
                    if topic_config.get('topic') == topic:
                        data_format = topic_config.get('data_format', 'JSON')
                        break
            
            tracks = TrackParser.parse(data, data_format, f"mqtt:{receiver_id}:{topic}")
            if tracks:
                self._stats[receiver_id]['parsed'] += len(tracks)
                for track in tracks:
                    # 统一添加source_name字段
                    track['source_name'] = source_name
                    ws_manager.queue_track_data(track)
            else:
                self._stats[receiver_id]['failed'] += 1
        return callback
    
    def _create_dds_callback(self, receiver_id: str):
        """创建DDS数据回调（闭包，绑定receiver_id）"""
        def callback(parsed_data: Dict[str, Any]):
            self._init_stats(receiver_id)
            self._stats[receiver_id]['received'] += 1
            
            if parsed_data:
                self._stats[receiver_id]['parsed'] += 1
                
                # 直接从DDS接收器获取name
                dds_receiver = self.dds_receivers.get(receiver_id)
                source_name = dds_receiver.name if dds_receiver and dds_receiver.name else 'DDS数据源'
                
                # 统一添加source_name字段
                parsed_data['source_name'] = source_name
                
                # 根据 data_type 区分发送不同类型的消息
                data_type = parsed_data.get('data_type', '')
                
                if data_type == 'camera_status':
                    if(parsed_data['entityId'] in ["camera_004","camera_001"]):
                        # print("*"*50)
                        # print("解析相机状态:",parsed_data)
                        # print("*"*50)
                        # 相机状态数据，发送为 Camera 类型
                        ws_manager.queue_message({
                            'type': 'Camera',
                            'data': parsed_data
                        })
                elif data_type == 'alarm_event':
                    # 告警数据，发送为 Alarm 类型
                    ws_manager.queue_message({
                        'type': 'Alarm',
                        'data': parsed_data
                    })
                elif data_type == 'multi_track_result':
                    # 多目标检测框数据
                    ws_manager.queue_message({
                        'type': 'MultiTrackResult',
                        'data': parsed_data
                    })
                elif data_type == 'single_track_result':
                    # 单目标检测框数据
                    ws_manager.queue_message({
                        'type': 'SingleTrackResult',
                        'data': parsed_data
                    })
                elif data_type == 'dock_status':
                    # 机场实时状态数据
                    ws_manager.queue_message({
                        'type': 'DockStatus',
                        'data': parsed_data
                    })
                elif data_type == 'drone_status':
                    # 无人机实时状态数据
                    ws_manager.queue_message({
                        'type': 'DroneStatus',
                        'data': parsed_data
                    })
                elif data_type == 'drone_task':
                    # 无人机任务状态数据（包含航线规划）
                    ws_manager.queue_message({
                        'type': 'DroneFlightPath',
                        'data': parsed_data
                    })
                elif data_type == 'high_freq':
                    # 高频位置数据
                    ws_manager.queue_message({
                        'type': 'HighFreq',
                        'data': parsed_data
                    })
                else:
                    # 航迹数据（fusion_track, ais_track, radar_track 等），发送为 Track 类型
                    ws_manager.queue_track_data(parsed_data)
            else:
                self._stats[receiver_id]['failed'] += 1
        return callback
    
    def _on_http_data(self, data: bytes, poller_id: str):
        """HTTP数据回调"""
        self._init_stats(poller_id)
        self._stats[poller_id]['received'] += 1
        
        poller = self.http_pollers.get(poller_id)
        data_format = poller.data_format if poller else 'JSON'
        source_name = poller.name if poller and poller.name else 'HTTP数据源'
        
        # 检查是否是实体状态数据
        if data_format == 'EntityStatus':
            try:
                import json
                json_data = json.loads(data.decode('utf-8'))
                result = parse_entity_status(json_data)
                
                if result:
                    # 准备发送到前端的数据（含 entities 全量 + relationships，不重复放在 cache_info 里）
                    ws_data = {
                        "type": "entity_status",
                        "source": poller_id,
                        "timestamp": result.get('timestamp'),
                        "total": result.get('total', 0),
                        "current_page": result.get('current_page', 1),
                        "total_pages": result.get('total_pages', 1),
                        "entities": result.get('entities', []),
                        "relationships": result.get('relationships', {}),
                    }
                    # 通过WebSocket发送
                    ws_manager.queue_message(ws_data)
                    self._stats[poller_id]['parsed'] += 1
                    rel = result.get('relationships') or {}
                    airports = rel.get('airports') or []
                    drone_count = sum(len(ap.get('drones') or []) for ap in airports)
                    logger.info(f"实体状态数据已发送 [{poller_id}]: {drone_count} 个无人机")
                else:
                    self._stats[poller_id]['failed'] += 1
            except Exception as e:
                logger.error(f"处理实体状态数据失败 [{poller_id}]: {e}")
                self._stats[poller_id]['failed'] += 1
            return
        
        # 其他数据格式使用航迹解析器
        tracks = TrackParser.parse(data, data_format, poller_id)
        if tracks:
            self._stats[poller_id]['parsed'] += len(tracks)
            for track in tracks:
                # 统一添加source_name字段
                track['source_name'] = source_name
                ws_manager.queue_track_data(track)
        else:
            self._stats[poller_id]['failed'] += 1
    
    async def start_http_pollers(self, configs: List[Dict[str, Any]]):
        """启动HTTP轮询器"""
        for config in configs:
            if not config.get('enabled', False):
                continue
            
            poller_id = config.get('id', '')
            if not poller_id:
                continue
            
            poller = HTTPPoller(config, self._on_http_data)
            self.http_pollers[poller_id] = poller
            await poller.start()
    
    def start_udp_receivers(self, configs: List[Dict[str, Any]]):
        """启动UDP接收器"""
        for config in configs:
            if not config.get('enabled', False):
                continue
            
            receiver_id = config.get('id', '')
            if not receiver_id:
                continue
            
            # 添加本机接口配置
            config['local_interface'] = self.local_interface
            
            receiver = UDPReceiver(config, self._on_udp_data)
            self.udp_receivers[receiver_id] = receiver
            receiver.start()
    
    def start_tcp_clients(self, configs: List[Dict[str, Any]]):
        """启动TCP客户端"""
        for config in configs:
            if not config.get('enabled', False):
                continue
            
            client_id = config.get('id', '')
            if not client_id:
                continue
            
            client = TCPClient(config, self._on_tcp_data)
            self.tcp_clients[client_id] = client
            client.start()
    
    def start_mqtt_receivers(self, configs: List[Dict[str, Any]]):
        """启动MQTT接收器（支持多个）"""
        for config in configs:
            if not config.get('enabled', False):
                continue
            
            receiver_id = config.get('id', '')
            if not receiver_id:
                continue
            
            callback = self._create_mqtt_callback(receiver_id)
            receiver = MQTTReceiver(config, callback)
            self.mqtt_receivers[receiver_id] = receiver
            receiver.start()
    
    def start_dds_receivers(self, configs: List[Dict[str, Any]]):
        """启动DDS接收器（支持多个，支持动态配置）"""
        if not DDS_AVAILABLE or DDSReceiverService is None:
            logger.warning("DDS功能不可用，跳过DDS接收器启动")
            return
        
        for config in configs:
            if not config.get('enabled', False):
                continue
            
            receiver_id = config.get('id', '')
            if not receiver_id:
                continue
            
            try:
                callback = self._create_dds_callback(receiver_id)
                
                # 构造source_config，直接使用config中的配置（不使用默认值）
                source_config = {
                    'source_id': receiver_id,
                    'name': config['name'],  # 存储name到接收器实例中
                    'dds_config': {
                        'domain_id': config['domain_id'],
                        'topic_name': config['topic_name'],
                        'profile_name': config['profile_name'],
                        'discovery_server_ip': config['discovery_server_ip'],
                        'discovery_server_port': config['discovery_server_port'],
                        'multicast_ip': config['multicast_ip'],
                        'multicast_port': config['multicast_port'],
                        'dds_module_path': config['dds_module_path'],
                        'structure_type': config['structure_type'],
                        'data_class_name': config['data_class_name'],
                        'pubsub_type_class_name': config['pubsub_type_class_name'],
                        'type_name': config['type_name'],
                        'use_default_xml': config['use_default_xml']
                    }
                }
                
                receiver = DDSReceiverService(
                    source_config=source_config,
                    data_callback=callback
                )
                # 存储name到接收器实例
                receiver.name = config['name']
                self.dds_receivers[receiver_id] = receiver
                logger.info(
                    f"✅ 动态DDS接收器已启动 [{receiver_id}] | "
                    f"域ID: {config.get('domain_id')} | "
                    f"主题: {config.get('topic_name')} | "
                    f"结构类型: {config.get('structure_type', 'track')}"
                )
            except Exception as e:
                logger.error(f"❌ DDS接收器启动失败 [{receiver_id}]: {e}")
                import traceback
                logger.debug(traceback.format_exc())
    
    async def start_http_pollers(self, configs: List[Dict[str, Any]]):
        """启动HTTP轮询器"""
        for config in configs:
            if not config.get('enabled', False):
                continue
            
            poller_id = config.get('id', '')
            if not poller_id:
                continue
            
            poller = HTTPPoller(config, self._on_http_data)
            self.http_pollers[poller_id] = poller
            await poller.start()
    
    def stop_all(self):
        """停止所有接收器"""
        # 停止UDP接收器
        for receiver in self.udp_receivers.values():
            receiver.stop()
        self.udp_receivers.clear()
        
        # 停止TCP客户端
        for client in self.tcp_clients.values():
            client.stop()
        self.tcp_clients.clear()
        
        # 停止MQTT接收器
        for receiver in self.mqtt_receivers.values():
            try:
                receiver.stop()
            except Exception as e:
                logger.error(f"停止MQTT接收器失败: {e}")
        self.mqtt_receivers.clear()
        
        # 停止DDS接收器
        for receiver_id, receiver in self.dds_receivers.items():
            try:
                receiver.delete()
            except Exception as e:
                logger.error(f"停止DDS接收器失败 [{receiver_id}]: {e}")
        self.dds_receivers.clear()
        
        logger.info("所有接收器已停止")
    
    async def stop_http_pollers(self):
        """停止HTTP轮询器"""
        for poller in self.http_pollers.values():
            await poller.stop()
        self.http_pollers.clear()
    
    def get_stats(self) -> Dict[str, Dict[str, int]]:
        """获取统计信息"""
        return dict(self._stats)


# 全局实例
receiver_manager = ReceiverManager()
