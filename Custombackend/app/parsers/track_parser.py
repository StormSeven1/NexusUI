"""
航迹数据解析器 - 将原始数据解析为统一的航迹格式
用于UDP/TCP/HTTP等非DDS数据源
"""
import json
import struct
from typing import Dict, Any, Optional, List
from datetime import datetime
from loguru import logger


class TrackParser:
    """航迹数据解析器"""
    
    # 统一的航迹格式
    TRACK_FIELDS = [
        'track_id',      # 航迹ID
        'latitude',      # 纬度
        'longitude',     # 经度
        'altitude',      # 高度
        'speed',         # 速度
        'course',        # 航向
        'timestamp',     # 时间戳
        'source',        # 数据来源
        'target_type',   # 目标类型
    ]
    
    @staticmethod
    def parse(data: bytes, data_format: str, source_id: str) -> Optional[List[Dict[str, Any]]]:
        """
        解析数据为统一航迹格式
        
        Args:
            data: 原始数据
            data_format: 数据格式类型
            source_id: 数据源ID
            
        Returns:
            解析后的航迹列表，解析失败返回None
        """
        try:
            if data_format == 'FusionTrack':
                return TrackParser._parse_fusion_track(data, source_id)
            elif data_format == 'AIS':
                return TrackParser._parse_ais(data, source_id)
            elif data_format == 'JSON':
                return TrackParser._parse_json(data, source_id)
            elif data_format == 'DroneTelemetry':
                return TrackParser._parse_drone_telemetry(data, source_id)
            else:
                # 尝试JSON解析
                return TrackParser._parse_json(data, source_id)
        except Exception as e:
            logger.debug(f"解析数据失败 [{source_id}]: {e}")
            return None
    
    @staticmethod
    def _parse_fusion_track(data: bytes, source_id: str) -> Optional[List[Dict[str, Any]]]:
        """解析融合航迹格式"""
        try:
            # 尝试JSON格式
            json_data = json.loads(data.decode('utf-8'))
            return TrackParser._normalize_json_tracks(json_data, source_id)
        except:
            pass
        
        # 尝试二进制格式（根据实际协议调整）
        try:
            tracks = []
            # 示例：假设每条航迹固定长度
            # 实际需要根据协议定义解析
            return tracks if tracks else None
        except:
            return None
    
    @staticmethod
    def _parse_ais(data: bytes, source_id: str) -> Optional[List[Dict[str, Any]]]:
        """解析AIS数据"""
        try:
            # 尝试JSON格式
            json_data = json.loads(data.decode('utf-8'))
            tracks = []
            
            if isinstance(json_data, list):
                for item in json_data:
                    track = TrackParser._ais_to_track(item, source_id)
                    if track:
                        tracks.append(track)
            elif isinstance(json_data, dict):
                track = TrackParser._ais_to_track(json_data, source_id)
                if track:
                    tracks.append(track)
            
            return tracks if tracks else None
        except:
            return None
    
    @staticmethod
    def _ais_to_track(ais_data: Dict, source_id: str) -> Optional[Dict[str, Any]]:
        """将AIS数据转换为航迹格式"""
        try:
            # 添加CPA和TCPA字段
            cpa = ais_data.get('cpa') or ais_data.get('CPA') or ais_data.get('closest_point_of_approach') or 0
            tcpa = ais_data.get('tcpa') or ais_data.get('TCPA') or ais_data.get('time_to_cpa') or 0
            
            return {
                'track_id': str(ais_data.get('mmsi', ais_data.get('id', ''))),
                'latitude': float(ais_data.get('latitude', ais_data.get('lat', 0))),
                'longitude': float(ais_data.get('longitude', ais_data.get('lon', 0))),
                'altitude': 0,
                'speed': float(ais_data.get('speed', ais_data.get('sog', 0))),
                'course': float(ais_data.get('course', ais_data.get('cog', 0))),
                'timestamp': ais_data.get('timestamp', datetime.now().isoformat()),
                'source': source_id,
                'target_type': 'AIS',
                'cpa': float(cpa),      # 添加CPA字段
                'tcpa': float(tcpa),    # 添加TCPA字段
                'raw_data': ais_data
            }
        except:
            return None
    
    @staticmethod
    def _parse_json(data: bytes, source_id: str) -> Optional[List[Dict[str, Any]]]:
        """解析JSON格式数据"""
        try:
            json_data = json.loads(data.decode('utf-8'))
            return TrackParser._normalize_json_tracks(json_data, source_id)
        except:
            return None
    
    @staticmethod
    def _normalize_json_tracks(json_data: Any, source_id: str) -> Optional[List[Dict[str, Any]]]:
        """标准化JSON航迹数据"""
        tracks = []
        
        if isinstance(json_data, list):
            for item in json_data:
                track = TrackParser._normalize_single_track(item, source_id)
                if track:
                    tracks.append(track)
        elif isinstance(json_data, dict):
            # 可能是单条航迹或包含航迹列表的对象
            if 'tracks' in json_data:
                for item in json_data['tracks']:
                    track = TrackParser._normalize_single_track(item, source_id)
                    if track:
                        tracks.append(track)
            elif 'data' in json_data:
                data_field = json_data['data']
                if isinstance(data_field, list):
                    for item in data_field:
                        track = TrackParser._normalize_single_track(item, source_id)
                        if track:
                            tracks.append(track)
                elif isinstance(data_field, dict):
                    track = TrackParser._normalize_single_track(data_field, source_id)
                    if track:
                        tracks.append(track)
            else:
                track = TrackParser._normalize_single_track(json_data, source_id)
                if track:
                    tracks.append(track)
        
        return tracks if tracks else None
    
    @staticmethod
    def _normalize_single_track(data: Dict, source_id: str) -> Optional[Dict[str, Any]]:
        """标准化单条航迹数据"""
        try:
            # 尝试提取各字段（支持多种字段名）
            track_id = data.get('track_id') or data.get('id') or data.get('trackId') or data.get('fused_track_id') or ''
            latitude = data.get('latitude') or data.get('lat') or 0
            longitude = data.get('longitude') or data.get('lon') or data.get('lng') or 0
            altitude = data.get('altitude') or data.get('alt') or data.get('height') or 0
            speed = data.get('speed') or data.get('velocity') or 0
            course = data.get('course') or data.get('heading') or data.get('azimuth') or 0
            timestamp = data.get('timestamp') or data.get('time') or data.get('record_time') or datetime.now().isoformat()
            target_type = data.get('target_type') or data.get('type') or 'Unknown'
            
            # 添加CPA和TCPA字段
            cpa = data.get('cpa') or data.get('CPA') or data.get('closest_point_of_approach') or 0
            tcpa = data.get('tcpa') or data.get('TCPA') or data.get('time_to_cpa') or 0
            
            if not track_id and not (latitude and longitude):
                return None
            
            return {
                'track_id': str(track_id),
                'latitude': float(latitude),
                'longitude': float(longitude),
                'altitude': float(altitude),
                'speed': float(speed),
                'course': float(course),
                'timestamp': str(timestamp),
                'source': source_id,
                'target_type': str(target_type),
                'cpa': float(cpa),      # 添加CPA字段
                'tcpa': float(tcpa),    # 添加TCPA字段
                'raw_data': data
            }
        except:
            return None
    
    @staticmethod
    def _parse_drone_telemetry(data: bytes, source_id: str) -> Optional[List[Dict[str, Any]]]:
        """解析无人机遥测数据"""
        try:
            json_data = json.loads(data.decode('utf-8'))
            
            # 提取无人机位置信息
            # 添加CPA和TCPA字段
            cpa = json_data.get('cpa') or json_data.get('CPA') or json_data.get('closest_point_of_approach') or 0
            tcpa = json_data.get('tcpa') or json_data.get('TCPA') or json_data.get('time_to_cpa') or 0
            
            track = {
                'track_id': str(json_data.get('drone_sn', json_data.get('id', ''))),
                'latitude': float(json_data.get('latitude', json_data.get('lat', 0))),
                'longitude': float(json_data.get('longitude', json_data.get('lon', 0))),
                'altitude': float(json_data.get('altitude', json_data.get('height', 0))),
                'speed': float(json_data.get('speed', json_data.get('horizontal_speed', 0))),
                'course': float(json_data.get('yaw', json_data.get('heading', 0))),
                'timestamp': json_data.get('timestamp', datetime.now().isoformat()),
                'source': source_id,
                'target_type': 'Drone',
                'cpa': float(cpa),      # 添加CPA字段
                'tcpa': float(tcpa),    # 添加TCPA字段
                'raw_data': json_data
            }
            
            if track['latitude'] and track['longitude']:
                return [track]
            return None
        except:
            return None
