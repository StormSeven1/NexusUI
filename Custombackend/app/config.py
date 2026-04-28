"""
配置模块 - 数据接收和服务配置
"""
from typing import List, Dict, Any
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置"""
    
    # 服务器配置
    HOST: str = "192.168.18.141"
    PORT: int = 26003
    
    # 本机网络接口IP（用于UDP组播接收）
    LOCAL_INTERFACE: str = "192.168.18.141"
    
    # 数据库配置（仅用于查询区域表）
    DATABASE_HOST: str = "192.168.18.141"
    DATABASE_PORT: int = 5432
    DATABASE_NAME: str = "watchsystem"
    DATABASE_USER: str = "postgres"
    DATABASE_PASSWORD: str = "123456"
    
    # WebSocket配置
    HEARTBEAT_INTERVAL: int = 10
    BROADCAST_INTERVAL: int = 100  # 毫秒
    
    # 日志配置
    LOG_LEVEL: str = "INFO"
    LOG_FILE: str = "logs/app.log"
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True
    )
    
    @property
    def database_url(self) -> str:
        return f"postgresql://{self.DATABASE_USER}:{self.DATABASE_PASSWORD}@{self.DATABASE_HOST}:{self.DATABASE_PORT}/{self.DATABASE_NAME}"


# UDP接收配置
UDP_RECEIVERS: List[Dict[str, Any]] = [
    # # 虚兵：航迹（DroneStatus + HighFreq），二进制格式见 parsers/virtual_unit_udp.py
    # {
    #     "id": "udp_virtual_unit_track",
    #     "name": "虚兵航迹上报(UDP)",
    #     "type": "unicast",
    #     "host": "0.0.0.0",
    #     "port": 27101,
    #     "enabled": True,
    #     "data_format": "VirtualUnitTrack",
    # },
    # # 虚兵：任务航线（DroneFlightPath），与 DDS drone_task 前端字段一致
    # {
    #     "id": "udp_virtual_unit_task",
    #     "name": "虚兵任务状态(UDP)",
    #     "type": "unicast",
    #     "host": "0.0.0.0",
    #     "port": 27102,
    #     "enabled": True,
    #     "data_format": "VirtualUnitDroneTask",
    # },
    # 组播示例
    # {
    #     "id": "ais_multicast",
    #     "name": "AIS组播",
    #     "type": "multicast",  # multicast/unicast/broadcast
    #     "host": "239.192.50.81",
    #     "port": 5081,
    #     "enabled": True,
    #     "data_format": "AIS"
    # },
    # {
    #     "id": "track_multicast",
    #     "name": "航迹组播",
    #     "type": "multicast",
    #     "host": "239.128.43.96",
    #     "port": 4397,
    #     "enabled": True,
    #     "data_format": "FusionTrack"
    # },
    # # 单播示例
    # {
    #     "id": "unicast_receiver",
    #     "name": "单播接收",
    #     "type": "unicast",
    #     "host": "0.0.0.0",
    #     "port": 23000,
    #     "enabled": True,
    #     "data_format": "FusionTrack"
    # },
    # # 广播示例
    # {
    #     "id": "broadcast_receiver",
    #     "name": "广播接收",
    #     "type": "broadcast",
    #     "host": "0.0.0.0",
    #     "port": 24000,
    #     "enabled": True,
    #     "data_format": "FusionTrack"
    # },
]

# TCP客户端配置
TCP_CLIENTS: List[Dict[str, Any]] = [
    # {
    #     "id": "tcp_client_1",
    #     "name": "TCP数据源",
    #     "host": "192.168.18.100",
    #     "port": 4377,
    #     "enabled": True,
    #     "data_format": "FusionTrack",
    #     "reconnect_interval": 5  # 重连间隔（秒）
    # },
]

# MQTT配置（支持多个）
MQTT_RECEIVERS: List[Dict[str, Any]] = [
    # {
    #     "id": "mqtt_drone",
    #     "name": "无人机MQTT",
    #     "enabled": True,
    #     "broker": "127.0.0.1",
    #     "port": 1883,
    #     "client_id": "track_relay_mqtt_1",
    #     "username": "admin",
    #     "password": "admin",
    #     "topics": [
    #         {"topic": "drone/+/telemetry", "data_format": "DroneTelemetry"},
    #     ]
    # },
]

# DDS配置（支持多个，支持动态数据结构）
# ⚠️ 重要：所有参数都必须在配置文件中明确指定，不使用默认值，不自动推导
# 必需参数：domain_id, topic_name, profile_name, discovery_server_ip, discovery_server_port,
#          multicast_ip, multicast_port, dds_module_path, structure_type, 
#          data_class_name, pubsub_type_class_name, type_name
DDS_RECEIVERS: List[Dict[str, Any]] = [
    {
        "id": "dds_alarm_event",
        "name": "DDS威胁告警列表",
        "enabled": True,
        "domain_id": 135,
        "topic_name": "AlarmEventTopic",
        "profile_name": "participant_alarmevent_recv_multi",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12359,
        "dds_module_path": "./DDSReferences/AlarmEvent",
        "structure_type": "alarm_data",
        "data_class_name": "AlarmEvent",
        "pubsub_type_class_name": "AlarmEventPubSubType",
        "type_name": "AlarmEvent",
        "use_default_xml": False
    },
    {
        "id": "dds_camera_status",
        "name": "DDS相机实时状态",
        "enabled": True,
        "domain_id": 149,
        "topic_name": "CameraRealTimeStatusTopic",
        "profile_name": "camera_status_subscriber",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12359,
        "dds_module_path": "./DDSReferences/Camera",
        "structure_type": "Camera",
        "data_class_name": "CameraRealTimeStatus",
        "pubsub_type_class_name": "CameraRealTimeStatusPubSubType",
        "type_name": "CameraRealTimeStatus",
        "use_default_xml": False
    },
    {
        "id": "dds_shore_multi_detection",
        "name": "DDS岸基相机多目标检测框",
        "enabled": True,
        "domain_id": 142,
        "topic_name": "MultiTrackResultTopic",
        "profile_name": "multi_track_subscriber_shore",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12359,
        "dds_module_path": "./DDSReferences/MultiTrackResult",
        "structure_type": "MultiCameraTrack",
        "data_class_name": "MultiTrackResult",
        "pubsub_type_class_name": "MultiTrackResultPubSubType",
        "type_name": "MultiTrackResult",
        "use_default_xml": False
    },
    {
        "id": "dds_shore_single_detection",
        "name": "DDS岸基相机单目标检测框",
        "enabled": True,
        "domain_id": 143,
        "topic_name": "SingleTrackResultTopic",
        "profile_name": "single_track_subscriber_shore",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12359,
        "dds_module_path": "./DDSReferences/SingleTrackResult",
        "structure_type": "SingleCameraTrack",
        "data_class_name": "SingleTrackResult",
        "pubsub_type_class_name": "SingleTrackResultPubSubType",
        "type_name": "SingleTrackResult",
        "use_default_xml": False
    },
   # === TrackManager转发的DDS航迹（forwardRules） ===
    {
        "id": "dds_forward_fuse_track",
        "name": "融合航迹",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "TrackDataClassTopic_FuseTrack",
        "profile_name": "track_publisher_forward_FuseTrack",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/fusion",
        "structure_type": "fusion_track",
        "data_class_name": "TrackDataClass",
        "pubsub_type_class_name": "TrackDataClassPubSubType",
        "type_name": "TrackDataClass",
        "use_default_xml": False
    },
    # {
    #     "id": "dds_forward_radar_track1",
    #     "name": "远遥航迹",
    #     "enabled": True,
    #     "domain_id": 141,
    #     "topic_name": "TrackDataClassTopic_RadarTrack1",
    #     "profile_name": "track_publisher_forward_RadarTrack1",
    #     "discovery_server_ip": "192.168.18.141",
    #     "discovery_server_port": 11611,
    #     "multicast_ip": "239.255.0.1",
    #     "multicast_port": 12355,
    #     "dds_module_path": "./DDSReferences/fusion",
    #     "structure_type": "radar_track",
    #     "data_class_name": "TrackDataClass",
    #     "pubsub_type_class_name": "TrackDataClassPubSubType",
    #     "type_name": "TrackDataClass",
    #     "use_default_xml": False
    # },
    # {
    #     "id": "dds_forward_radar_track2",
    #     "name": "靖子头航迹",
    #     "enabled": True,
    #     "domain_id": 141,
    #     "topic_name": "TrackDataClassTopic_RadarTrack2",
    #     "profile_name": "track_publisher_forward_RadarTrack2",
    #     "discovery_server_ip": "192.168.18.141",
    #     "discovery_server_port": 11611,
    #     "multicast_ip": "239.255.0.1",
    #     "multicast_port": 12355,
    #     "dds_module_path": "./DDSReferences/fusion",
    #     "structure_type": "radar_track",
    #     "data_class_name": "TrackDataClass",
    #     "pubsub_type_class_name": "TrackDataClassPubSubType",
    #     "type_name": "TrackDataClass",
    #     "use_default_xml": False
    # },
    # {
    #     "id": "dds_forward_ais_track",
    #     "name": "AIS航迹",
    #     "enabled": True,
    #     "domain_id": 141,
    #     "topic_name": "TrackDataClassTopic_AISTrack",
    #     "profile_name": "track_publisher_forward_AISTrack",
    #     "discovery_server_ip": "192.168.18.141",
    #     "discovery_server_port": 11611,
    #     "multicast_ip": "239.255.0.1",
    #     "multicast_port": 12355,
    #     "dds_module_path": "./DDSReferences/fusion",
    #     "structure_type": "ais_track",
    #     "data_class_name": "TrackDataClass",
    #     "pubsub_type_class_name": "TrackDataClassPubSubType",
    #     "type_name": "TrackDataClass",
    #     "use_default_xml": False
    # },
    # {
    #     "id": "dds_forward_bird_radar_track",
    #     "name": "探鸟航迹",
    #     "enabled": True,
    #     "domain_id": 141,
    #     "topic_name": "TrackDataClassTopic_BirdRadarTrack",
    #     "profile_name": "track_publisher_forward_BirdRadarTrack",
    #     "discovery_server_ip": "192.168.18.141",
    #     "discovery_server_port": 11611,
    #     "multicast_ip": "239.255.0.1",
    #     "multicast_port": 12355,
    #     "dds_module_path": "./DDSReferences/fusion",
    #     "structure_type": "radar_track",
    #     "data_class_name": "TrackDataClass",
    #     "pubsub_type_class_name": "TrackDataClassPubSubType",
    #     "type_name": "TrackDataClass",
    #     "use_default_xml": False
    # },
    # {
    #     "id": "dds_forward_ku_radar_track",
    #     "name": "Ku雷达航迹",
    #     "enabled": True,
    #     "domain_id": 141,
    #     "topic_name": "TrackDataClassTopic_KuRadarTrack",
    #     "profile_name": "track_publisher_forward_KuRadarTrack",
    #     "discovery_server_ip": "192.168.18.141",
    #     "discovery_server_port": 11611,
    #     "multicast_ip": "239.255.0.1",
    #     "multicast_port": 12355,
    #     "dds_module_path": "./DDSReferences/fusion",
    #     "structure_type": "radar_track",
    #     "data_class_name": "TrackDataClass",
    #     "pubsub_type_class_name": "TrackDataClassPubSubType",
    #     "type_name": "TrackDataClass",
    #     "use_default_xml": False
    # },
    {
        "id": "dds_forward_fuse_bird_radar_track",
        "name": "对空融合航迹",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "TrackDataClassTopic_FuseBirdRadarTrack",
        "profile_name": "track_publisher_forward_FuseBirdRadarTrack",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/fusion",
        "structure_type": "fusion_track",
        "data_class_name": "TrackDataClass",
        "pubsub_type_class_name": "TrackDataClassPubSubType",
        "type_name": "TrackDataClass",
        "use_default_xml": False
    },
    # {
    #     "id": "dds_forward_uav_pose_track",
    #     "name": "自报位航迹",
    #     "enabled": True,
    #     "domain_id": 141,
    #     "topic_name": "TrackDataClassTopic_UAVPoseTrack",
    #     "profile_name": "track_publisher_forward_UAVPoseTrack",
    #     "discovery_server_ip": "192.168.18.141",
    #     "discovery_server_port": 11611,
    #     "multicast_ip": "239.255.0.1",
    #     "multicast_port": 12355,
    #     "dds_module_path": "./DDSReferences/fusion",
    #     "structure_type": "radar_track",
    #     "data_class_name": "TrackDataClass",
    #     "pubsub_type_class_name": "TrackDataClassPubSubType",
    #     "type_name": "TrackDataClass",
    #     "use_default_xml": False
    # },
    # {
    #     "id": "dds_forward_auto_bird_radar_track",
    #     "name": "智能航迹（探鸟雷达）",
    #     "enabled": True,
    #     "domain_id": 141,
    #     "topic_name": "TrackDataClassTopic_AutoBirdRadarTrack",
    #     "profile_name": "track_publisher_forward_AutoBirdRadarTrack",
    #     "discovery_server_ip": "192.168.18.141",
    #     "discovery_server_port": 11611,
    #     "multicast_ip": "239.255.0.1",
    #     "multicast_port": 12355,
    #     "dds_module_path": "./DDSReferences/fusion",
    #     "structure_type": "radar_track",
    #     "data_class_name": "TrackDataClass",
    #     "pubsub_type_class_name": "TrackDataClassPubSubType",
    #     "type_name": "TrackDataClass",
    #     "use_default_xml": False
    # },
    # === 新增DDS配置 ===
    # === 新增DDS配置 ===
    {
        "id": "dds_dock2_status",
        "name": "机场实时状态",
        "enabled": True,  # TODO: 需要配置profile_name后启用
        "domain_id": 115,
        "topic_name": "dock2RealTimeStatusTopic",
        "profile_name": "dock2_status_subscriber",  # TODO: 配置实际的profile_name
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/dock",
        "structure_type": "dock_status",
        "data_class_name": "dock2RealTimeStatus",
        "pubsub_type_class_name": "dock2RealTimeStatusPubSubType",
        "type_name": "casia::device::status::dock2Status::dock2RealTimeStatus",
        "use_default_xml": False
    },
    {
        "id": "dds_drone_status",
        "name": "无人机实时状态",
        "enabled": True,  # TODO: 需要配置profile_name后启用
        "domain_id": 115,
        "topic_name": "droneRealTimeStatusTopic",
        "profile_name": "drone_status_subscriber",  # TODO: 配置实际的profile_name
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/drone",
        "structure_type": "drone_status",
        "data_class_name": "droneRealTimeStatus",
        "pubsub_type_class_name": "droneRealTimeStatusPubSubType",
        "type_name": "casia::device::status::dronestatus::droneRealTimeStatus",
        "use_default_xml": False
    },
    {
        "id": "dds_drone_task",
        "name": "无人机任务状态",
        "enabled": True,  # TODO: 需要配置profile_name后启用
        "domain_id": 115,
        "topic_name": "DroneTaskRealTimeStatusTopic",
        "profile_name": "drone_task_subscriber",  # TODO: 配置实际的profile_name
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/DroneTask",
        "structure_type": "drone_task",
        "data_class_name": "DroneTaskRealTimeStatus",
        "pubsub_type_class_name": "DroneTaskRealTimeStatusPubSubType",
        "type_name": "casia::device::status::dronetask::DroneTaskRealTimeStatus",
        "use_default_xml": False
    },
    {
        "id": "dds_high_freq",
        "name": "高频位置数据",
        "enabled": True,  # TODO: 需要配置profile_name后启用
        "domain_id": 115,
        "topic_name": "highFreqRealTimeStatusTopic",
        "profile_name": "high_freq_subscriber",  # TODO: 配置实际的profile_name
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/highFreq",
        "structure_type": "high_freq",
        "data_class_name": "highFreqRealTimeStatus",
        "pubsub_type_class_name": "highFreqRealTimeStatusPubSubType",
        "type_name": "casia::device::status::drcstatus::highFreqRealTimeStatus",
        "use_default_xml": False
    }
]

# HTTP轮询配置
HTTP_POLLERS: List[Dict[str, Any]] = [
    {
        "id": "entity_status_poller",
        "name": "实体状态轮询",
        "url": "http://192.168.18.141:8090/api/v1/entities",
        "method": "GET",
        "poll_interval": 5.0,
        "enabled": True,
        "data_format": "EntityStatus",
        "headers": {},
        "params": {"page": 1, "size": 100},
        "auth": None
    },
]


def get_settings() -> Settings:
    return Settings()
