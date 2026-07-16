"""
接收器管理器 - 统一管理所有数据接收器
"""
import asyncio
import json
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
from parsers.entity_parser import parse_entities_response, parse_relationships_response
from parsers.new_track_struct_grpc_parser import parse_target_output_set
from grpc_services.entity.client import EntityGrpcClient
from grpc_services.new_track_struct.client import NewTrackStructGrpcClient
from websocket_manager import ws_manager

# DDS接收器（可选）- 使用动态DDS接收器服务
if not DDS_AVAILABLE:
    logger.warning("DDS功能不可用（FastDDS库未安装或模块未找到）")


class ReceiverManager:
    """接收器管理器"""
    
    def __init__(self, local_interface: str = "0.0.0.0"):
        self.local_interface = local_interface
        self.event_loop: Optional[asyncio.AbstractEventLoop] = None
        
        # 接收器实例
        self.udp_receivers: Dict[str, UDPReceiver] = {}
        self.tcp_clients: Dict[str, TCPClient] = {}
        self.http_pollers: Dict[str, HTTPPoller] = {}
        self.entity_grpc_clients: Dict[str, EntityGrpcClient] = {}
        self.track_grpc_clients: Dict[str, NewTrackStructGrpcClient] = {}
        self.mqtt_receivers: Dict[str, MQTTReceiver] = {}
        self.dds_receivers: Dict[str, Any] = {}  # DDSReceiver实例
        
        # 统计信息
        self._stats: Dict[str, Dict[str, int]] = {}
        self._latest_entities_result: Optional[Dict[str, Any]] = None
        self._latest_relationships_result: Optional[Dict[str, Any]] = None
    
    def _init_stats(self, receiver_id: str):
        """初始化统计信息"""
        if receiver_id not in self._stats:
            self._stats[receiver_id] = {
                'received': 0,
                'parsed': 0,
                'failed': 0
            }
    
    def _entity_lookup(self) -> Dict[str, Dict[str, Any]]:
        entities = (self._latest_entities_result or {}).get("entities") or []
        if not isinstance(entities, list):
            return {}
        lookup: Dict[str, Dict[str, Any]] = {}
        for item in entities:
            if not isinstance(item, dict):
                continue
            entity_id = str(item.get("entityId", "")).strip()
            if entity_id:
                lookup[entity_id] = item
        return lookup

    def _enrich_eo_fusion_source_names(self, track_data: Dict[str, Any]) -> None:
        fusion_sources = track_data.get("fusionSources")
        if not isinstance(fusion_sources, list):
            return

        entity_lookup = self._entity_lookup()
        if not entity_lookup:
            return

        changed = False
        for source in fusion_sources:
            if not isinstance(source, dict):
                continue
            if str(source.get("sourceType") or "").strip().lower() != "eo":
                continue

            entity_id = str(source.get("dataSourceId") or "").strip()
            if not entity_id:
                continue

            entity = entity_lookup.get(entity_id)
            if not isinstance(entity, dict):
                continue

            entity_name = str(entity.get("name") or "").strip()
            if not entity_name:
                continue

            if source.get("sourceName") != entity_name:
                source["sourceName"] = entity_name
                changed = True

        if changed:
            track_data["reserved6"] = json.dumps(fusion_sources, ensure_ascii=False)

    def _emit_unified_entity_status(self, source: str) -> bool:
        if not self._latest_entities_result:
            return False

        entities_result = self._latest_entities_result
        relationships_result = self._latest_relationships_result or {"nodes": [], "edges": []}
        entities = entities_result.get("entities", [])

        try:
            from parsers.dds_parser import sync_dock_sn_map_from_relationships
            from http_api import set_latest_entity_records

            sync_dock_sn_map_from_relationships(relationships_result, self._entity_lookup())
            set_latest_entity_records(entities)
        except Exception as exc:
            logger.error(f"同步统一实体缓存失败: {exc}")

        # for entity in entities:
        #     if not isinstance(entity, dict):
        #         continue
        #     entity_id = str(entity.get("entityId", "")).strip()
        #     if not entity_id:
        #         continue
        #     logger.info(
        #         f"[entity_status] {entity_id} => "
        #         f"assetType={entity.get('assetType') or '-'} "
        #         f"disposition={entity.get('disposition') or '-'} "
        #         f"virtualTroop={bool(entity.get('virtualTroop') is True)} "
        #         f"deviceSn={entity.get('deviceSn') or '-'} "
        #         f"gatewaySn={entity.get('gatewaySn') or '-'} "
        #         f"videoAddress={entity.get('videoAddress') or '-'}"
        #     )

        for entity in entities:
            if isinstance(entity, dict) and str(entity.get("entityId", "")).strip() == "camera_004":
                # print("[YUANYAO_VISIBLE_STATUS][WS_ENTITY_STATUS_SEND]", {
                #     "source": source,
                #     "entityId": entity.get("entityId"),
                #     "status": entity.get("status"),
                #     "deviceState": entity.get("deviceState"),
                #     "platformActivity": entity.get("platformActivity"),
                #     "role": entity.get("role"),
                # })
                break

        ws_manager.queue_message({
            "type": "entity_status",
            "source": source,
            "timestamp": entities_result.get("timestamp"),
            "total": entities_result.get("total", 0),
            "current_page": entities_result.get("current_page", 1),
            "total_pages": entities_result.get("total_pages", 1),
            "entities": entities,
            "relationships": relationships_result,
        })
        logger.info(
            f"统一 entity_status 已更新并广播到前端 [{source}]: "
            f"{len(entities)} 个实体, "
            f"{len(relationships_result.get('nodes') or [])} 个节点, "
            f"{len(relationships_result.get('edges') or [])} 条关系"
        )
        return True

    def _on_entity_grpc_entities(self, result: Dict[str, Any], client_id: str):
        """gRPC entity list callback."""
        self._init_stats(client_id)
        self._stats[client_id]['received'] += 1
        if not result:
            self._stats[client_id]['failed'] += 1
            return
        self._latest_entities_result = result
        if self._latest_relationships_result is None:
            self._latest_relationships_result = {"nodes": [], "edges": []}
        self._stats[client_id]['parsed'] += 1

    def _on_entity_grpc_relationships(self, payload: Dict[str, Any], client_id: str):
        """gRPC entity relationship callback."""
        self._init_stats(client_id)
        self._stats[client_id]['received'] += 1
        try:
            result = parse_relationships_response(payload, self._entity_lookup())
            if not result:
                self._stats[client_id]['failed'] += 1
                return
            self._latest_relationships_result = result
            if self._emit_unified_entity_status(client_id):
                self._stats[client_id]['parsed'] += 1
            else:
                self._stats[client_id]['failed'] += 1
        except Exception as exc:
            logger.error(f"处理实体关系 gRPC 数据失败 [{client_id}]: {exc}")
            self._stats[client_id]['failed'] += 1

    def _on_entity_grpc_status(self, patch: Dict[str, Any], client_id: str):
        """gRPC streaming entity status callback."""
        self._init_stats(client_id)
        entity_id = str((patch or {}).get("entityId") or "").strip()
        if not entity_id:
            return

        direct_message_types = {
            "camera_status": "Camera",
            "dock_status": "DockStatus",
            "radar_status": "RadarStatus",
            "drone_status": "DroneStatus",
            "drone_task": "DroneFlightPath",
            "high_freq": "HighFreq",
            "munition_status": "MunitionStatus",
            "usv_status": "UsvStatus",
            "laser_status": "LaserStatus",
            "tdoa_status": "TdoaStatus",
        }
        direct_type = direct_message_types.get(str(patch.get("data_type") or ""))
        if direct_type:
            direct_payload = {
                key: value
                for key, value in patch.items()
                if not key.startswith("_") and value is not None
            }
            direct_payload["source_name"] = client_id
            ws_manager.queue_message({
                "type": direct_type,
                "data": direct_payload,
            })
            # if(direct_type == "Camera"):
            #     print("Camera:",direct_payload)

        entities_result = self._latest_entities_result
        if not entities_result:
            self._stats[client_id]['parsed'] += 1
            return

        entities = entities_result.get("entities") or []
        changed = False
        for entity in entities:
            if not isinstance(entity, dict):
                continue
            if str(entity.get("entityId") or "").strip() != entity_id:
                continue
            for key, value in patch.items():
                if key in {"entityId", "_grpcStatusRaw", "_grpcStatusType"}:
                    continue
                if value is not None:
                    entity[key] = value
            changed = True
            break
        if not changed:
            new_entity = {
                key: value
                for key, value in patch.items()
                if not key.startswith("_") and value is not None
            }
            entities.append(new_entity)
            entities_result["entities"] = entities
            entities_result["total"] = len(entities)
        entities_result["timestamp"] = patch.get("timestamp") or entities_result.get("timestamp")
        self._stats[client_id]['parsed'] += 1

    @staticmethod
    def _is_air_track(track: Dict[str, Any]) -> bool:
        environment = track.get("environment")
        try:
            if int(environment) == 2:
                return True
        except (TypeError, ValueError):
            pass
        category = str(track.get("trackCategoryName") or "").strip().lower()
        return category in {"bird", "uav", "drone", "helicopter", "aircraft", "missile"}

    def _on_track_grpc_output_set(self, output_set: Any, client_id: str):
        """gRPC NewTrackStruct TargetOutputSet callback."""
        self._init_stats(client_id)
        self._stats[client_id]['received'] += 1

        try:
            tracks = parse_target_output_set(output_set)
        except Exception as exc:
            logger.error(f"处理 NewTrackStruct gRPC 航迹失败 [{client_id}]: {exc}")
            self._stats[client_id]['failed'] += 1
            return

        if not tracks:
            self._stats[client_id]['failed'] += 1
            return

        client = self.track_grpc_clients.get(client_id)
        source_name = client.name if client and client.name else "NewTrackStruct gRPC"
        for track in tracks:
            track["source_name"] = source_name
            track["dataSourceId"] = client_id
            track["is_air_track"] = self._is_air_track(track)
            self._enrich_eo_fusion_source_names(track)
            ws_manager.queue_track_data(track)
        self._stats[client_id]['parsed'] += len(tracks)

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

        if data_format == 'SpeedCamera':
            from parsers.high_speed_camera_udp import parse_high_speed_camera_udp
            messages, ok = parse_high_speed_camera_udp(data, source_name)
            if ok and messages:
                for msg in messages:
                    ws_manager.queue_message(msg)
                self._stats[receiver_id]['parsed'] += len(messages)
            elif ok:
                self._stats[receiver_id]['parsed'] += 1
            else:
                self._stats[receiver_id]['failed'] += 1
            return
        
        # 解析数据
        if data_format == 'Destroy':
            try:
                payload = json.loads(data.decode('utf-8-sig'))
                if not isinstance(payload, dict):
                    raise ValueError("destroy UDP payload must be a JSON object")

                async def publish_destroy():
                    from grpc_services.destroy.service import destroy_grpc_service

                    connected = await destroy_grpc_service.publish_destroy_http_body(payload)
                    logger.info(
                        f"[destroy-udp] published destroy event [{receiver_id}] "
                        f"from {addr}: task_id={payload.get('taskId', '')}, connected_clients={connected}"
                    )

                if self.event_loop is None:
                    raise RuntimeError("receiver manager event loop is not initialized")
                asyncio.run_coroutine_threadsafe(publish_destroy(), self.event_loop)
                self._stats[receiver_id]['parsed'] += 1
            except Exception as e:
                logger.error(f"处理消灭UDP数据失败 [{receiver_id}] from {addr}: {e}")
                self._stats[receiver_id]['failed'] += 1
            return

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
                self._enrich_eo_fusion_source_names(parsed_data)
                
                # 根据 data_type 区分发送不同类型的消息
                data_type = parsed_data.get('data_type', '')
                
                if data_type == 'camera_status':
                    # if str(parsed_data.get('entityId', '')).strip() == "camera_004":
                    #     print("[YUANYAO_VISIBLE_STATUS][DDS_CAMERA_SEND]", {
                    #         "receiver": receiver_id,
                    #         "source": source_name,
                    #         "entityId": parsed_data.get("entityId"),
                    #         "deviceState": parsed_data.get("deviceState"),
                    #         "online": parsed_data.get("online"),
                    #         "taskType": parsed_data.get("taskType"),
                    #         "executionState": parsed_data.get("executionState"),
                    #         "timestamp": parsed_data.get("timestamp"),
                    #     })
                    if(parsed_data['entityId'] in ["camera_004","camera_001","camera-hs-001","camera-hs-002","camera-hs-003","camera-hs-004"]):
                        # print("*"*50)
                        print("解析相机状态:",parsed_data)
                        # print("*"*50)
                        # 相机状态数据，发送为 Camera 类型
                        ws_manager.queue_message({
                            'type': 'Camera',
                            'data': parsed_data
                        })
                elif data_type == 'multi_track_result':
                    # 多目标检测框消息在后端这里不做重同步，只做转发。
                    # 前端收到后会继续：
                    # 1. 按 cameraId 过滤到当前视频对应的相机
                    # 2. 再按 syncHeader 尽量对齐当前展示的 WebRTC 视频帧
                    ws_manager.queue_message({
                        'type': 'MultiTrackResult',
                        'data': parsed_data
                    })
                elif data_type == 'single_track_result':
                    # 单目标检测框和多目标检测框走同一条链路：
                    # 后端负责转发，前端负责帧级同步和覆盖层绘制。
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
                elif data_type == 'radar_status':
                    ws_manager.queue_message({
                        'type': 'RadarStatus',
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
                elif data_type == 'munition_status':
                    ws_manager.queue_message({
                        'type': 'MunitionStatus',
                        'data': parsed_data
                    })
                elif data_type == 'usv_status':
                    ws_manager.queue_message({
                        'type': 'UsvStatus',
                        'data': parsed_data
                    })
                elif data_type == 'laser_status':
                    ws_manager.queue_message({
                        'type': 'LaserStatus',
                        'data': parsed_data
                    })
                elif data_type == 'tdoa_status':
                    ws_manager.queue_message({
                        'type': 'TdoaStatus',
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
                json_data = json.loads(data.decode('utf-8'))
                records = ((json_data.get("data") or {}).get("records") or []) if isinstance(json_data, dict) else []
                for raw_entity in records:
                    if isinstance(raw_entity, dict) and str(raw_entity.get("entityId", "")).strip() == "camera_004":
                        raw_status = raw_entity.get("status")
                        print("[YUANYAO_VISIBLE_STATUS][HTTP_RAW]", {
                            "poller": poller_id,
                            "entityId": raw_entity.get("entityId"),
                            "status": raw_status,
                            "status.deviceState": raw_status.get("deviceState") if isinstance(raw_status, dict) else None,
                            "isLive": raw_entity.get("isLive"),
                            "online": raw_entity.get("online"),
                        })
                        break
                result = parse_entities_response(json_data)
                if not result:
                    self._stats[poller_id]['failed'] += 1
                    return
                for parsed_entity in result.get("entities", []):
                    if isinstance(parsed_entity, dict) and str(parsed_entity.get("entityId", "")).strip() == "camera_004":
                        print("[YUANYAO_VISIBLE_STATUS][HTTP_PARSED]", {
                            "poller": poller_id,
                            "entityId": parsed_entity.get("entityId"),
                            "status": parsed_entity.get("status"),
                            "deviceState": parsed_entity.get("deviceState"),
                            "platformActivity": parsed_entity.get("platformActivity"),
                            "role": parsed_entity.get("role"),
                        })
                        break

                self._latest_entities_result = result
                if self._latest_relationships_result is None:
                    self._latest_relationships_result = {"nodes": [], "edges": []}
                if self._emit_unified_entity_status(poller_id):
                    self._stats[poller_id]['parsed'] += 1
                else:
                    self._stats[poller_id]['failed'] += 1
            except Exception as e:
                logger.error(f"处理实体状态数据失败 [{poller_id}]: {e}")
                self._stats[poller_id]['failed'] += 1
            return

        if data_format == 'EntityRelationships':
            try:
                json_data = json.loads(data.decode('utf-8'))
                result = parse_relationships_response(json_data, self._entity_lookup())
                if not result:
                    self._stats[poller_id]['failed'] += 1
                    return

                self._latest_relationships_result = result
                if self._emit_unified_entity_status(poller_id):
                    self._stats[poller_id]['parsed'] += 1
                else:
                    self._stats[poller_id]['parsed'] += 1
            except Exception as e:
                logger.error(f"处理实体关系数据失败 [{poller_id}]: {e}")
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
                        'dds_module_name': config.get('dds_module_name', ''),
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

    async def start_entity_grpc_clients(self, configs: List[Dict[str, Any]]):
        """启动实体 gRPC 客户端"""
        for config in configs:
            if not config.get('enabled', False):
                continue

            client_id = config.get('id', '')
            if not client_id or client_id in self.entity_grpc_clients:
                continue

            client = EntityGrpcClient(
                config,
                self._on_entity_grpc_entities,
                self._on_entity_grpc_relationships,
                self._on_entity_grpc_status,
            )
            self.entity_grpc_clients[client_id] = client
            await client.start()

    async def start_track_grpc_clients(self, configs: List[Dict[str, Any]]):
        """启动 NewTrackStruct gRPC 航迹客户端。"""
        for config in configs:
            if not config.get('enabled', False):
                continue

            client_id = config.get('id', '')
            if not client_id or client_id in self.track_grpc_clients:
                continue

            client = NewTrackStructGrpcClient(config, self._on_track_grpc_output_set)
            self.track_grpc_clients[client_id] = client
            await client.start()
    
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

    async def stop_entity_grpc_clients(self):
        """停止实体 gRPC 客户端"""
        for client in self.entity_grpc_clients.values():
            await client.stop()
        self.entity_grpc_clients.clear()

    async def stop_track_grpc_clients(self):
        """Stop NewTrackStruct gRPC track clients."""
        for client in self.track_grpc_clients.values():
            await client.stop()
        self.track_grpc_clients.clear()
    
    def get_stats(self) -> Dict[str, Dict[str, int]]:
        """获取统计信息"""
        return dict(self._stats)


# 全局实例
receiver_manager = ReceiverManager()
