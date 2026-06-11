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
from receivers.network.dds_receiver_service import (
    DDS_SUBSCRIPTION_MATCHED,
    _TRACK_STRUCTURE_TYPES,
)
from receivers.network.dds_track_bridge import get_track_bridge
from parsers import TrackParser
from parsers.entity_parser import parse_entity_status
from websocket_manager import ws_manager

# DDS 航迹 receiver_id → 前端 track_layer_key（与 NexusUI map-entity-model / track-layer-visibility 一致）
TRACK_LAYER_KEY_BY_RECEIVER = {
    "dds_forward_fuse_track": "fuse_sea",
    "dds_forward_fuse_track_virtual": "fuse_sea",
    "dds_forward_fuse_bird_radar_track": "fuse_air",
    "dds_forward_fuse_bird_radar_track_virtual": "fuse_air",
    "dds_forward_bird_radar_track": "bird_radar",
    "dds_forward_fanwu_car_track": "fanwu_car_radar",
    "dds_forward_radar_track1": "radar_wharf",
    "dds_forward_radar_track2": "radar_jingzi",
    "dds_forward_ais_track": "ais_track",
    "dds_forward_uav_pose_track": "uav_pose_track",
}


def _mark_virtual_track_from_dds_topic(track: Dict[str, Any], topic_name: str) -> None:
    """TrackManager 虚兵专用 topic（*_virtual）上的目标一律按虚兵下发。"""
    if not topic_name or "_virtual" not in topic_name.lower():
        return
    track["reality_type"] = 2
    track["is_virtual"] = True
    track["virtualTroop"] = True


def _annotate_track_receiver_metadata(track: Dict[str, Any], receiver_id: str, source_name: str) -> None:
    """供 WS 前端归类显隐：来源名 + 接收器 id + track_layer_key（若配置表命中）"""
    track["source_name"] = source_name
    track["dds_source_id"] = receiver_id
    lk = TRACK_LAYER_KEY_BY_RECEIVER.get(receiver_id)
    if lk:
        track["track_layer_key"] = lk


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
        self.dds_receivers: Dict[str, Any] = {}  # DDSReceiver实例（非航迹；航迹在独立子进程）
        self._dds_track_meta: Dict[str, Dict[str, str]] = {}  # 子进程航迹：receiver_id -> topic/name
        
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
                _annotate_track_receiver_metadata(track, receiver_id, source_name)
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
                _annotate_track_receiver_metadata(track, client_id, source_name)
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
                    _annotate_track_receiver_metadata(track, receiver_id, source_name)
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
                    # 相机状态：全量转发至 WS（勿按 entityId 白名单过滤，否则光电页 DDS 任务条无数据）
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
                    # 无人机任务：航线仍走 DroneFlightPath；光电右下角任务态走 DroneTaskStatus
                    ws_manager.queue_message({
                        'type': 'DroneFlightPath',
                        'data': parsed_data
                    })
                    ws_manager.queue_message({
                        'type': 'DroneTaskStatus',
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
                    dds_receiver = self.dds_receivers.get(receiver_id)
                    topic_name = getattr(dds_receiver, "topic_name", "") if dds_receiver else ""
                    _mark_virtual_track_from_dds_topic(parsed_data, topic_name)
                    _annotate_track_receiver_metadata(parsed_data, receiver_id, source_name)
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
                _annotate_track_receiver_metadata(track, poller_id, source_name)
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
    
    @staticmethod
    def _dds_receiver_boot_order(config: Dict[str, Any]) -> tuple:
        """
        同进程多路 DDS 的启动顺序：航迹必须先于 Entity/相机。
        否则 Entity RTLD_GLOBAL 预加载会污染符号，导致航迹订阅反复失效（与 target_id 等前端改动无关）。
        """
        structure_type = config.get("structure_type", "")
        receiver_id = config.get("id", "")
        if structure_type == "new_track_struct":
            return (0, receiver_id)
        if structure_type in _TRACK_STRUCTURE_TYPES:
            return (1, receiver_id)
        if structure_type in ("MultiCameraTrack", "SingleCameraTrack", "alarm_data"):
            return (2, receiver_id)
        if structure_type in ("Camera", "high_freq", "drone_task", "drone_status", "dock_status"):
            return (3, receiver_id)
        return (2, receiver_id)

    @staticmethod
    def _is_track_dds_config(config: Dict[str, Any]) -> bool:
        return config.get("structure_type", "") in _TRACK_STRUCTURE_TYPES

    def _on_track_worker_data(
        self,
        receiver_id: str,
        topic_name: str,
        source_name: str,
        parsed_data: Dict[str, Any],
    ) -> None:
        """航迹子进程 Queue → 复用主进程 DDS 回调（WS 下发）。"""
        if parsed_data and not parsed_data.get("source_name"):
            parsed_data["source_name"] = source_name or self._dds_track_meta.get(receiver_id, {}).get("name", "DDS数据源")
        self._create_dds_callback(receiver_id)(parsed_data)

    def start_dds_receivers(self, configs: List[Dict[str, Any]]):
        """启动DDS接收器（支持多个，支持动态配置）"""
        if not DDS_AVAILABLE or DDSReceiverService is None:
            enabled = [c.get("id", "") for c in configs if c.get("enabled", False)]
            logger.error(
                "DDS 航迹不可用：容器/环境无法 import fastdds（Python 绑定 + libfastdds 未就绪），"
                "已跳过 {} 个已启用 DDS 源，前端将收不到 DDS 融合的航迹。",
                len(enabled),
            )
            logger.error(
                "处理办法：改用带 FastDDS 的镜像（如团队 ubuntu-fastdds-python / fast_dds_with_app），"
                "或在当前镜像安装 eProsima Fast-DDS 及 Python 绑定并配置 LD_LIBRARY_PATH。"
            )
            if enabled:
                logger.error("当前被跳过的 DDS 源 id（需在修复环境后重启后端）: {}", ", ".join(enabled))
            return
        
        enabled_configs = [c for c in configs if c.get("enabled", False) and c.get("id")]
        track_configs = [c for c in enabled_configs if self._is_track_dds_config(c)]
        other_configs = [c for c in enabled_configs if not self._is_track_dds_config(c)]

        if track_configs:
            for cfg in track_configs:
                rid = cfg["id"]
                self._dds_track_meta[rid] = {
                    "topic_name": cfg.get("topic_name", ""),
                    "name": cfg.get("name", ""),
                }
                # 占位：健康检查 / stats 能识别航迹 receiver_id
                self.dds_receivers[rid] = type(
                    "TrackSubprocessProxy",
                    (),
                    {
                        "name": cfg.get("name", ""),
                        "structure_type": cfg.get("structure_type", ""),
                        "topic_name": cfg.get("topic_name", ""),
                    },
                )()
            bridge = get_track_bridge()
            bridge.start(track_configs, self._on_track_worker_data)

        ordered_configs = sorted(other_configs, key=self._dds_receiver_boot_order)
        if track_configs or ordered_configs:
            logger.info(
                "DDS 启动: 航迹子进程 {} 路 | 主进程 {}",
                len(track_configs),
                " → ".join(c["id"] for c in ordered_configs) if ordered_configs else "(无)",
            )

        for config in ordered_configs:
            receiver_id = config.get('id', '')
            
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
                        'dds_module_name': config.get('dds_module_name', ''),
                        'data_class_name': config['data_class_name'],
                        'pubsub_type_class_name': config['pubsub_type_class_name'],
                        'type_name': config['type_name'],
                        'use_default_xml': config['use_default_xml'],
                        'subscriber_xml_file': config.get('subscriber_xml_file', ''),
                        'dds_python_module': config.get('dds_python_module', ''),
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
        
        # 停止航迹 DDS 子进程
        try:
            get_track_bridge().stop()
        except Exception as e:
            logger.error(f"停止航迹 DDS 子进程失败: {e}")

        # 停止主进程 DDS 接收器
        for receiver_id, receiver in list(self.dds_receivers.items()):
            if receiver_id in self._dds_track_meta:
                continue
            try:
                receiver.delete()
            except Exception as e:
                logger.error(f"停止DDS接收器失败 [{receiver_id}]: {e}")
        self.dds_receivers.clear()
        self._dds_track_meta.clear()
        
        logger.info("所有接收器已停止")
    
    async def stop_http_pollers(self):
        """停止HTTP轮询器"""
        for poller in self.http_pollers.values():
            await poller.stop()
        self.http_pollers.clear()
    
    def get_stats(self) -> Dict[str, Dict[str, int]]:
        """获取统计信息"""
        return dict(self._stats)

    def get_dds_track_health(self) -> Dict[str, Any]:
        """航迹 DDS 健康度：匹配数 + 已收样本（供启动自检与 /api/status 扩展）"""
        bridge = get_track_bridge()
        if bridge.is_running or bridge._track_receiver_ids:
            bridge.drain_messages()
            return bridge.get_health(self._stats)
        track_ids = [
            rid for rid, recv in self.dds_receivers.items()
            if getattr(recv, "structure_type", "") in _TRACK_STRUCTURE_TYPES
        ]
        matched = {rid: DDS_SUBSCRIPTION_MATCHED.get(rid, 0) for rid in track_ids}
        received = {
            rid: self._stats.get(rid, {}).get("received", 0)
            for rid in track_ids
        }
        return {
            "mode": "inprocess",
            "track_receiver_ids": track_ids,
            "subscription_matched": matched,
            "received": received,
            "any_matched": any(v > 0 for v in matched.values()),
            "any_received": any(v > 0 for v in received.values()),
        }


# 全局实例
receiver_manager = ReceiverManager()
