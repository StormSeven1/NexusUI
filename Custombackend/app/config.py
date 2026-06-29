"""
配置模块 - 数据接收和服务配置
"""
import os
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

    # 相机任务转发默认目标（请求体无 backendBaseUrl 时使用；与现场实体服务一致）
    CAMERA_TASK_BACKEND_BASE_URL: str = "http://192.168.18.141:8088"

    # 系统评估 gRPC 服务（system-evaluation-server），格式 host:port
    SYSTEM_EVAL_GRPC_TARGET: str = "192.168.18.141:50091"

    # DDS 无人机状态/任务/高频等落盘到 app/data/drone_logs（jsonl）
    ENABLE_DRONE_DATA_STORAGE: bool = False

    # 相机实时状态 DDS 订阅：legacy=domain149 | entity=domain200 | both=双路（见 NEXUS_DDS_CAMERA_STATUS_MODE）
    NEXUS_DDS_CAMERA_STATUS_MODE: str = "legacy"
    
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
# 航迹 DDS 在独立子进程（dds_track_bridge），与 Entity/相机 彻底隔离；修改相机/target_id 勿动航迹项。
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
        "id": "dds_suspicious_target",
        "name": "DDS可疑目标(NewTrackStructSuspicious)",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "NewTrackStructSuspicious",
        "profile_name": "track_subscriber_newstruct_suspicious",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/NewTrackStruct/build",
        "structure_type": "suspicious_target",
        "dds_module_name": "NewTrackRealTimeStatus",
        "data_class_name": "TargetOutputSet",
        "pubsub_type_class_name": "TargetOutputSetPubSubType",
        "type_name": "TargetFull::TargetOutputSet",
        "subscriber_xml_file": "newtrack_sub_recv.xml",
        "use_default_xml": False
    },
    {
        "id": "dds_camera_status",
        "name": "DDS相机实时状态(新版 IDL，Topic CameraRealTimeStatusTopic)",
        "enabled": True,
        "domain_id": 200,
        "topic_name": "CameraRealTimeStatusTopic",
        "profile_name": "camera_status_subscriber",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12359,
        "dds_module_path": "./DDSReferences/Entity",
        "subscriber_xml_file": "camera_status_subscriber.xml",
        "dds_python_module": "EntityRealTimeStatus",
        "structure_type": "Camera",
        "data_class_name": "CameraRealTimeStatus",
        "pubsub_type_class_name": "CameraRealTimeStatusPubSubType",
        "type_name": "casia::device::status::CameraStatus::CameraRealTimeStatus",
        "use_default_xml": False
    },
    {
        "id": "dds_camera_status_legacy",
        "name": "DDS相机实时状态(旧版扁平结构，Topic CameraRealTimeStatusTopic1)",
        "enabled": True,
        "domain_id": 149,
        "topic_name": "CameraRealTimeStatusTopic1",
        "profile_name": "camera_status_subscriber",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12359,
        # 旧版扁平 CameraRealTimeStatus（独立 IDL，仍在 Camera 目录）
        "dds_module_path": "./DDSReferences/Camera",
        "subscriber_xml_file": "dds_subscriber_CameraRealTimeStatusTopic_149_camera_status_subscriber.xml",
        "structure_type": "Camera",
        "data_class_name": "CameraRealTimeStatus",
        "pubsub_type_class_name": "CameraRealTimeStatusPubSubType",
        "type_name": "casia::device::status::CameraRealTimeStatus",
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
        "name": "对海融合航迹",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "TrackTopic_NewStruct_FuseTrack",
        # 必须与虚兵/对空等其它 NewStruct 接收器区分开：Fast DDS 在同进程合并 XML，participant profile_name 重复会导致后续订阅 XML 加载失败、收不到样本
        "profile_name": "track_subscriber_newstruct_fuse_sea",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12370,
        "dds_module_path": "./DDSReferences/NewTrackStruct/build",
        "structure_type": "new_track_struct",
        "dds_module_name": "NewTrackRealTimeStatus",
        "data_class_name": "TargetOutputSet",
        "pubsub_type_class_name": "TargetOutputSetPubSubType",
        "type_name": "TargetFull::TargetOutputSet",
        "subscriber_xml_file": "newtrack_sub_recv.xml",
        "use_default_xml": False
    },
    {
        "id": "dds_forward_fuse_track_virtual",
        "name": "对海融合航迹(虚兵)",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "TrackTopic_NewStruct_FuseTrack_virtual",
        "profile_name": "track_subscriber_newstruct_fuse_sea_virtual",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/NewTrackStruct/build",
        "structure_type": "new_track_struct",
        "dds_module_name": "NewTrackRealTimeStatus",
        "data_class_name": "TargetOutputSet",
        "pubsub_type_class_name": "TargetOutputSetPubSubType",
        "type_name": "TargetFull::TargetOutputSet",
        "subscriber_xml_file": "newtrack_sub_recv.xml",
        "use_default_xml": False
    },
    {
        "id": "dds_forward_radar_track1",
        "name": "远遥码头雷达航迹",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "TrackDataClassTopic_RadarTrack1",
        "profile_name": "track_publisher_forward_RadarTrack1",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/fusion",
        "structure_type": "radar_track",
        "data_class_name": "TrackDataClass",
        "pubsub_type_class_name": "TrackDataClassPubSubType",
        "type_name": "TrackDataClass",
        "use_default_xml": False
    },
    {
        "id": "dds_forward_radar_track2",
        "name": "靖子头雷达航迹",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "TrackDataClassTopic_RadarTrack2",
        "profile_name": "track_publisher_forward_RadarTrack2",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/fusion",
        "structure_type": "radar_track",
        "data_class_name": "TrackDataClass",
        "pubsub_type_class_name": "TrackDataClassPubSubType",
        "type_name": "TrackDataClass",
        "use_default_xml": False
    },
    {
        "id": "dds_forward_ais_track",
        "name": "AIS航迹",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "TrackDataClassTopic_AISTrack",
        "profile_name": "track_publisher_forward_AISTrack",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12360,
        "dds_module_path": "./DDSReferences/fusion",
        "structure_type": "ais_track",
        "data_class_name": "TrackDataClass",
        "pubsub_type_class_name": "TrackDataClassPubSubType",
        "type_name": "TrackDataClass",
        "use_default_xml": False
    },
    {
        "id": "dds_forward_bird_radar_track",
        "name": "探鸟雷达航迹",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "TrackDataClassTopic_BirdRadarTrack",
        "profile_name": "track_publisher_forward_BirdRadarTrack",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/fusion",
        "structure_type": "radar_track",
        "data_class_name": "TrackDataClass",
        "pubsub_type_class_name": "TrackDataClassPubSubType",
        "type_name": "TrackDataClass",
        "use_default_xml": False
    },
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
        "topic_name": "TrackTopic_NewStruct_FuseBirdTrack",
        "profile_name": "track_subscriber_newstruct_fuse_air",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12370,
        "dds_module_path": "./DDSReferences/NewTrackStruct/build",
        "structure_type": "new_track_struct",
        "dds_module_name": "NewTrackRealTimeStatus",
        "data_class_name": "TargetOutputSet",
        "pubsub_type_class_name": "TargetOutputSetPubSubType",
        "type_name": "TargetFull::TargetOutputSet",
        "subscriber_xml_file": "newtrack_sub_recv.xml",
        "use_default_xml": False
    },
    {
        "id": "dds_forward_fuse_bird_radar_track_virtual",
        "name": "对空融合航迹(虚兵)",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "TrackTopic_NewStruct_FuseBirdTrack_virtual",
        "profile_name": "track_subscriber_newstruct_fuse_air_virtual",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/NewTrackStruct/build",
        "structure_type": "new_track_struct",
        "dds_module_name": "NewTrackRealTimeStatus",
        "data_class_name": "TargetOutputSet",
        "pubsub_type_class_name": "TargetOutputSetPubSubType",
        "type_name": "TargetFull::TargetOutputSet",
        "subscriber_xml_file": "newtrack_sub_recv.xml",
        "use_default_xml": False
    },
    {
        "id": "dds_forward_fanwu_car_track",
        "name": "反无车雷达航迹",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "TrackTopic_NewStruct_FanWuCarTrack",
        "profile_name": "track_subscriber_newstruct_fanwu_car",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/NewTrackStruct/build",
        "structure_type": "new_track_struct",
        "dds_module_name": "NewTrackRealTimeStatus",
        "data_class_name": "TargetOutputSet",
        "pubsub_type_class_name": "TargetOutputSetPubSubType",
        "type_name": "TargetFull::TargetOutputSet",
        "subscriber_xml_file": "newtrack_sub_recv.xml",
        "use_default_xml": False
    },
    {
        "id": "dds_forward_uav_pose_track",
        "name": "自报位航迹",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "TrackDataClassTopic_UAVPoseTrack",
        "profile_name": "track_publisher_forward_UAVPoseTrack",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12360,
        "dds_module_path": "./DDSReferences/fusion",
        "structure_type": "radar_track",
        "data_class_name": "TrackDataClass",
        "pubsub_type_class_name": "TrackDataClassPubSubType",
        "type_name": "TrackDataClass",
        "use_default_xml": False
    },
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
        "enabled": True,
        "domain_id": 115,
        "topic_name": "DroneTaskRealTimeStatusTopic",
        "profile_name": "drone_task_subscriber",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        # 现场发布端仍为旧 IDL：casia::device::status::dronetask::DroneTaskRealTimeStatus
        # （Entity 新 type_name 订阅匹配不到，received=0）。任务文案在 rev1，解析器映射到 drone_task_action。
        "dds_module_path": "./DDSReferences/DroneTask",
        "subscriber_xml_file": "dds_subscriber_DroneTaskRealTimeStatusTopic_115_drone_task_subscriber.xml",
        "structure_type": "drone_task",
        "data_class_name": "DroneTaskRealTimeStatus",
        "pubsub_type_class_name": "DroneTaskRealTimeStatusPubSubType",
        "type_name": "casia::device::status::dronetask::DroneTaskRealTimeStatus",
        "use_default_xml": False
    },
    {
        "id": "dds_high_freq",
        "name": "高频位置数据(新版 Entity IDL，与现场发布端 domain 200 对齐)",
        "enabled": True,
        "domain_id": 200,
        "topic_name": "highFreqRealTimeStatusTopic",
        "profile_name": "test_highfreq_client",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/Entity",
        "subscriber_xml_file": "highfreq_subscriber.xml",
        "dds_python_module": "EntityRealTimeStatus",
        "structure_type": "high_freq",
        "data_class_name": "highFreqRealTimeStatus",
        "pubsub_type_class_name": "highFreqRealTimeStatusPubSubType",
        "type_name": "casia::device::status::DroneGeneralStatus::DroneStatus::highFreqRealTimeStatus",
        "use_default_xml": False
    }
]


def resolve_dds_camera_status_mode(raw: str | None = None) -> str:
    """归一化相机 DDS 模式：legacy | entity | both"""
    mode = (raw if raw is not None else os.environ.get("NEXUS_DDS_CAMERA_STATUS_MODE", "legacy")).strip().lower()
    if mode in ("entity", "200", "new", "dds_camera_status"):
        return "entity"
    if mode in ("both", "all", "dual"):
        return "both"
    return "legacy"


def apply_dds_camera_status_mode(receivers: List[Dict[str, Any]], mode: str | None = None) -> str:
    """按 NEXUS_DDS_CAMERA_STATUS_MODE 启用 dds_camera_status / dds_camera_status_legacy 之一或两者。"""
    resolved = resolve_dds_camera_status_mode(mode)
    entity_on = resolved in ("entity", "both")
    legacy_on = resolved in ("legacy", "both")
    for rec in receivers:
        rid = rec.get("id")
        if rid == "dds_camera_status":
            rec["enabled"] = entity_on
        elif rid == "dds_camera_status_legacy":
            rec["enabled"] = legacy_on
    return resolved


DDS_CAMERA_STATUS_MODE = apply_dds_camera_status_mode(DDS_RECEIVERS)

# 系统工作模式 DDS 发布（供前端 TopNav 下拉框调用 /api/system/work-mode）
# 需先在 DDSReferences/WorkMode 下编译出 libWorkModeStatus.so 与 _WorkModeStatusWrapper.so
WORK_MODE_DDS_PUBLISHER: Dict[str, Any] = {
    "enabled": True,
    # 周期性重复发布当前模式（秒）；0 表示仅在手 POST /api/system/work-mode 时发布
    "repeat_interval_sec": 10,
    # 从未通过 API 设置模式时，周期任务使用的默认模式
    "default_mode_key": "normal",
    "domain_id": 115,
    "topic_name": "WorkModeStatusTopic",
    "profile_name": "work_mode_publisher",
    "discovery_server_ip": "192.168.18.141",
    "discovery_server_port": 11611,
    "multicast_ip": "239.255.0.1",
    "multicast_port": 12355,
    "dds_module_relative_path": "DDSReferences/WorkMode",
    "structure_type": "WorkModeStatus",
    "data_class_name": "WorkModeStatus",
    "pubsub_type_class_name": "WorkModeStatusPubSubType",
    "type_name": "casia::system::workmode::WorkModeStatus",
}

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
        # 8090 实体总数 >100 时分页；合并全部页后再发 entity_status（含 uav-011 等第 2 页无人机）
        "fetch_all_pages": True,
        "auth": None
    },
]


def get_settings() -> Settings:
    return Settings()
