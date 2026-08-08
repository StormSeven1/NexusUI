"""
配置模块 - 数据接收和服务配置
"""
import os
import re
from typing import List, Dict, Any
from loguru import logger
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
    # 广播节拍：保持较小以保航迹实时性；卡顿应靠并行发送/超时踢慢客户端，勿靠加大本值
    BROADCAST_INTERVAL: int = 100  # 毫秒
    # 单客户端一拍发送超时（秒）。超时只踢该慢连接，不拖累其他前端实时性
    WS_CLIENT_SEND_TIMEOUT_SEC: float = 0.15
    
    # 日志配置
    LOG_LEVEL: str = "INFO"
    LOG_FILE: str = "logs/app.log"

    # 相机任务转发默认目标（请求体无 backendBaseUrl 时使用；与现场实体服务一致）
    CAMERA_TASK_BACKEND_BASE_URL: str = "http://192.168.18.141:8088"

    # 系统评估 gRPC 服务（system-evaluation-server），格式 host:port
    SYSTEM_EVAL_GRPC_TARGET: str = "192.168.18.141:50091"

    # DDS 无人机状态/任务/高频等落盘到 app/data/drone_logs（jsonl）
    ENABLE_DRONE_DATA_STORAGE: bool = False

    # 对空融合航迹解析自报位+探鸟雷达批号，写入雷达训练真值表
    ENABLE_RADAR_TRAIN_LABEL_COLLECT: bool = True
    RADAR_TRAIN_LABEL_TTL_SEC: int = 7200
    RADAR_TRAIN_LABEL_PERSIST: bool = True
    # 采集校验 / is_uav：仅认 last_seen 在此秒数内的「自报位+探鸟」真值（当前仍在刷）
    BIRD_RADAR_QUALIFYING_FRESH_SEC: float = 20.0
    # 命中真值后自动采 10s 探鸟 UDP 点迹 → tracks_*.csv（已由顶栏手动采集取代）
    ENABLE_RADAR_TRAIN_AUTO_CAPTURE: bool = False
    RADAR_TRAIN_CAPTURE_DURATION_SEC: float = 10.0
    BIRD_RADAR_CAPTURE_IDLE_SEC: int = 60

    # 对空/探鸟雷达数据采集 UDP 下发（对齐 Widget SendAirRadarCollectDataIP/Port）
    AIR_RADAR_COLLECT_SEND_IP: str = ""
    AIR_RADAR_COLLECT_SEND_PORT: int = 0
    # 探鸟雷达站址（手动点选方位/距离中心，对齐 Config_Radar RadarAttr2）
    AIR_RADAR_COLLECT_RADAR_LAT: float = 37.54887
    AIR_RADAR_COLLECT_RADAR_LON: float = 122.09432

    # 相机实时状态 DDS 订阅：legacy=domain149 | entity=domain200 | both=双路（见 NEXUS_DDS_CAMERA_STATUS_MODE）
    NEXUS_DDS_CAMERA_STATUS_MODE: str = "legacy"

    # 无人机状态/任务/高频：dds | grpc（见 NEXUS_DRONE_STATUS_TRANSPORT）
    NEXUS_DRONE_STATUS_TRANSPORT: str = "dds"
    NEXUS_DRONE_ENTITY_GRPC_URL: str = "192.168.18.141:51070"
    NEXUS_DRONE_HOSTILE_GRPC_URL: str = "192.168.18.141:50065"

    # 对空/对海融合航迹：dds | grpc（见 NEXUS_FUSION_TRACK_TRANSPORT）
    NEXUS_FUSION_TRACK_TRANSPORT: str = "dds"
    NEXUS_NEW_TRACK_STRUCT_GRPC_URL: str = "192.168.18.141:60055"
    # 航迹类告警：embedded=从 NewTrackStruct 目标.alarms 读（证据链同源）；dds=仍订 AlarmEventTopic
    NEXUS_TRACK_ALARM_TRANSPORT: str = "embedded"
    # 蓝方虚兵航迹：独立 NewTrackStruct gRPC 一路（不替代、不开关原有 DDS/虚兵融合）
    NEXUS_VIRTUAL_NEW_TRACK_STRUCT_GRPC_URL: str = "192.168.18.116:50065"

    # 传感器旁路航迹（雷达/AIS/探鸟/自报位/反无车/智能跟踪等）：dds | grpc
    # grpc 时改从 FusionTrack 统一流(:60056)消费，用其全局唯一 uniqueId 做 showID，
    # 与 NewTrackStruct(:60055) 融合 target_id 同池不撞 → 与融合可同时显示。
    NEXUS_RADAR_TRACK_TRANSPORT: str = "dds"
    NEXUS_FUSION_TRACK_STREAM_GRPC_URL: str = "192.168.18.141:60056"
    # FusionTrack 旁路源白名单（英文 dataSourceId，逗号分隔）。
    # 空 / all / * = 摄入全部已知源；填写则仅注入列出的源。
    # 格式：id | id|显示名 | id:layer | id:layer|显示名 | id:中文名
    NEXUS_FUSION_TRACK_GRPC_SOURCES: str = ""
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )
    
    @property
    def database_url(self) -> str:
        return f"postgresql://{self.DATABASE_USER}:{self.DATABASE_PASSWORD}@{self.DATABASE_HOST}:{self.DATABASE_PORT}/{self.DATABASE_NAME}"


# UDP接收配置
UDP_RECEIVERS: List[Dict[str, Any]] = [
    {
        # 探鸟雷达「智能跟踪航迹」：与 Config_Radar [RadarAttr2] RadarNewTrackIP/Port 一致
        "id": "udp_auto_bird_radar",
        "name": "探鸟智能跟踪航迹(UDP)",
        "type": "multicast",
        "host": "224.0.1.162",
        "port": 14444,
        "enabled": True,
        "data_format": "SPxTrackExt",
        "buffer_size": 65536,
        # 不写 local_interface 时用 Settings.LOCAL_INTERFACE（141 本机 ens22f0）
    },
    {
        "id": "udp_bird_radar_ml",
        "name": "探鸟雷达ML原始点迹(UDP)",
        "type": "unicast",
        "host": "0.0.0.0",
        "port": 8001,
        # 关闭 bind：8001 由现场 start.py（分类推理）占用。
        # 探鸟采集改走 AF_PACKET 旁路嗅探（radar_train/udp_sniffer.py）。
        "enabled": False,
        "data_format": "BirdRadarMLPacket",
        "buffer_size": 81920,
    },
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
        # 航迹类告警：默认不再订阅（NEXUS_TRACK_ALARM_TRANSPORT=embedded），改从目标结构 alarms/embedded_alarms 读。
        # 本项保留完整 DDS 形态，便于切回 dds 或对照现场。
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
        "enabled": False,
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
        "enabled": False,  # 前端无消费者（检测框走 camServer ws:2088），禁用节省 ~154/s 无效推送
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
        "enabled": False,  # 前端无消费者（检测框走 camServer ws:2088），禁用节省 ~26/s 无效推送
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
    {
        "id": "dds_udp_boatself_track",
        "name": "船自报位航迹",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "TrackDataClassTopic_BoatSelfTrack",
        "profile_name": "track_publisher_forward_BoatSelfTrack",
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
    {
        "id": "dds_udp_xpf_track",
        "name": "远遥鹏飞航迹",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "TrackDataClassTopic_YuanYaoPengFeiTrack",
        "profile_name": "track_publisher_forward_YuanYaoPengFeiTrack",
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

_DRONE_DDS_RECEIVER_IDS = ("dds_drone_status", "dds_drone_task", "dds_high_freq")

# 对空/对海融合 NewTrackStruct（含虚兵 topic）；切 gRPC 时关闭，其它航迹仍走 DDS
_FUSION_DDS_RECEIVER_IDS = (
    "dds_forward_fuse_track",
    "dds_forward_fuse_track_virtual",
    "dds_forward_fuse_bird_radar_track",
    "dds_forward_fuse_bird_radar_track_virtual",
)

# FusionTrack gRPC 旁路源对应的 DDS 接收器；切 grpc 时关闭，避免双点
_RADAR_DDS_RECEIVER_IDS = (
    "dds_forward_radar_track1",  # 远遥码头雷达 → yuan_yao
    "dds_forward_radar_track2",  # 靖子头雷达 → jing_zi_tou
    "dds_udp_xpf_track",         # 远遥鹏飞 → udp_xpf_track
    "dds_udp_boatself_track",    # 船只自报位 → udp_boatself_track
    "dds_forward_ais_track",     # AIS → ais
    "dds_forward_bird_radar_track",  # 探鸟雷达 → tan_niao
    "dds_forward_uav_pose_track",    # 无人机自报位 → zi_bao_wei
    "dds_forward_fanwu_car_track",   # 反无车 → udp_fanwucar_track
)

# FusionTrack gRPC 旁路源对应的 UDP 接收器；切 grpc 时关闭，避免双点
_RADAR_UDP_RECEIVER_IDS = (
    "udp_auto_bird_radar",  # 探鸟智能跟踪 → auto_bird
)

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

# 8090 实体列表默认值（与 nexus-ui `NEXUS_ENTITIES_LIST_URL` 同键；现场用 .env 覆盖）
DEFAULT_NEXUS_ENTITIES_LIST_URL = (
    "http://192.168.18.141:8090/api/v1/entities?page=1&size=100"
)


def _ensure_app_dotenv() -> None:
    """
    把现场配置补进 os.environ（不覆盖已有环境变量，便于 docker -e）。
    顺序：Custombackend/app/.env → 仓库 site-host.env → nexus-ui/.env.local
    这样 18.36 只需 git pull + 本机已有 site-host/.env.local，不必两边改代码。
    """
    app_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(app_dir, "..", ".."))
    candidates = (
        os.path.join(app_dir, ".env"),
        os.path.join(repo_root, "site-host.env"),
        os.path.join(repo_root, "nexus-ui", ".env.local"),
    )
    try:
        from dotenv import dotenv_values
    except Exception as e:
        logger.debug("python-dotenv unavailable: {}", e)
        return
    for env_path in candidates:
        if not os.path.isfile(env_path):
            continue
        try:
            for key, value in dotenv_values(env_path).items():
                if value is None or key in os.environ:
                    continue
                os.environ[key] = value
        except Exception as e:
            logger.debug("load env {} skipped: {}", env_path, e)


def _env_truthy(name: str, default: str = "false") -> bool:
    return (os.environ.get(name) or default).strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def build_http_pollers() -> List[Dict[str, Any]]:
    """
    构建 HTTP 轮询器列表。

    实体状态轮询地址读环境变量 ``NEXUS_ENTITIES_LIST_URL``（与前端同键），
    勿再写死 141/36 IP。8090 若开 Keycloak，设：
      NEXUS_ENTITIES_AUTH_ENABLED=true
      NEXUS_ENTITIES_KEYCLOAK_USERNAME / PASSWORD
      （URL/realm 默认同 KEYCLOAK_*；client 默认 entity_management）
    """
    from urllib.parse import parse_qs, urlparse, urlunparse

    _ensure_app_dotenv()
    raw = (os.environ.get("NEXUS_ENTITIES_LIST_URL") or "").strip()
    if not raw:
        site = (os.environ.get("SITE_LAN_HOST") or "").strip()
        if site:
            raw = f"http://{site}:8090/api/v1/entities?page=1&size=100"
        else:
            raw = DEFAULT_NEXUS_ENTITIES_LIST_URL
    parsed = urlparse(raw)
    if not parsed.scheme or not parsed.netloc:
        logger.warning(
            "NEXUS_ENTITIES_LIST_URL 无效 [{}]，回退默认 {}",
            raw,
            DEFAULT_NEXUS_ENTITIES_LIST_URL,
        )
        raw = DEFAULT_NEXUS_ENTITIES_LIST_URL
        parsed = urlparse(raw)

    qs = parse_qs(parsed.query, keep_blank_values=False)
    try:
        page = int((qs.get("page") or ["1"])[0] or 1)
    except ValueError:
        page = 1
    try:
        size = int((qs.get("size") or ["100"])[0] or 100)
    except ValueError:
        size = 100
    base_url = urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", "", ""))

    auth: Dict[str, Any] | None = None
    static_token = (os.environ.get("NEXUS_ENTITIES_BEARER_TOKEN") or "").strip()
    if static_token:
        auth = {"type": "bearer", "token": static_token}
    elif _env_truthy("NEXUS_ENTITIES_AUTH_ENABLED"):
        kc_url = (
            os.environ.get("NEXUS_ENTITIES_KEYCLOAK_URL")
            or os.environ.get("KEYCLOAK_URL")
            or ""
        ).strip().rstrip("/")
        realm = (
            os.environ.get("NEXUS_ENTITIES_KEYCLOAK_REALM")
            or os.environ.get("KEYCLOAK_REALM")
            or "airia"
        ).strip()
        client_id = (
            os.environ.get("NEXUS_ENTITIES_KEYCLOAK_CLIENT_ID") or "entity_management"
        ).strip()
        username = (os.environ.get("NEXUS_ENTITIES_KEYCLOAK_USERNAME") or "").strip()
        password = os.environ.get("NEXUS_ENTITIES_KEYCLOAK_PASSWORD") or ""
        if kc_url and username and password:
            auth = {
                "type": "keycloak_password",
                "token_url": f"{kc_url}/realms/{realm}/protocol/openid-connect/token",
                "client_id": client_id,
                "username": username,
                "password": password,
            }
        else:
            logger.warning(
                "NEXUS_ENTITIES_AUTH_ENABLED=true 但缺少 "
                "KEYCLOAK_URL / NEXUS_ENTITIES_KEYCLOAK_USERNAME|PASSWORD；"
                "将无鉴权请求 {}",
                base_url,
            )

    logger.info(
        "entity_status_poller URL={} page={} size={} auth={}",
        base_url,
        page,
        size,
        (auth or {}).get("type") or "none",
    )
    return [
        {
            "id": "entity_status_poller",
            "name": "实体状态轮询",
            "url": base_url,
            "method": "GET",
            "poll_interval": 5.0,
            "enabled": True,
            "data_format": "EntityStatus",
            "headers": {},
            "params": {"page": page, "size": size},
            # 8090 实体总数 >100 时分页；合并全部页后再发 entity_status
            "fetch_all_pages": True,
            "auth": auth,
        },
    ]


# 兼容旧 import；启动时请用 build_http_pollers() 以读取最新环境变量
HTTP_POLLERS: List[Dict[str, Any]] = build_http_pollers()


def get_settings() -> Settings:
    return Settings()


def _split_host_port(url: str, default_host: str, default_port: int) -> tuple[str, int]:
    raw = (url or "").strip()
    if not raw:
        return default_host, default_port
    if "://" in raw:
        raw = raw.split("://", 1)[1]
    if ":" in raw:
        host, port_s = raw.rsplit(":", 1)
        try:
            return host.strip() or default_host, int(port_s.strip())
        except ValueError:
            return raw.strip() or default_host, default_port
    return raw, default_port


def resolve_drone_status_transport(raw: str | None = None) -> str:
    """归一化无人机状态通道：dds | grpc"""
    mode = (
        raw
        if raw is not None
        else os.environ.get("NEXUS_DRONE_STATUS_TRANSPORT", "dds")
    ).strip().lower()
    if mode in ("grpc", "entity_status_grpc", "entity_status"):
        return "grpc"
    return "dds"


def build_drone_status_grpc_receivers(settings: Settings | None = None) -> List[Dict[str, Any]]:
    """无人机 EntityStatus gRPC 订阅源（地址来自环境变量）。"""
    s = settings or get_settings()
    entity_host, entity_port = _split_host_port(
        s.NEXUS_DRONE_ENTITY_GRPC_URL, "192.168.18.141", 51070
    )
    hostile_host, hostile_port = _split_host_port(
        s.NEXUS_DRONE_HOSTILE_GRPC_URL, "192.168.18.141", 50065
    )
    return [
        {
            "id": "grpc_drone_entity",
            "name": "实体无人机 EntityStatus gRPC",
            "host": entity_host,
            "port": entity_port,
            "enabled": True,
        },
        {
            "id": "grpc_drone_hostile",
            "name": "蓝方无人机 EntityStatus gRPC",
            "host": hostile_host,
            "port": hostile_port,
            "enabled": True,
        },
    ]


def apply_drone_status_transport(
    dds_receivers: List[Dict[str, Any]],
    grpc_receivers: List[Dict[str, Any]],
    mode: str | None = None,
) -> str:
    """按 NEXUS_DRONE_STATUS_TRANSPORT 启用 DDS 或 gRPC 无人机订阅。"""
    resolved = resolve_drone_status_transport(mode)
    use_grpc = resolved == "grpc"
    for rec in dds_receivers:
        if rec.get("id") in _DRONE_DDS_RECEIVER_IDS:
            rec["enabled"] = not use_grpc
    for rec in grpc_receivers:
        rec["enabled"] = use_grpc
    return resolved


DRONE_STATUS_GRPC_RECEIVERS = build_drone_status_grpc_receivers()
DRONE_STATUS_TRANSPORT = apply_drone_status_transport(
    DDS_RECEIVERS, DRONE_STATUS_GRPC_RECEIVERS
)


# ──────────────────────────────────────────────────────────────────
# 相机实时状态 EntityStatus gRPC（替代 dds_camera_status）
# 需要 camServer SiteProfile.ini 中 UseEntityGrpc=1 + EntityStatusGrpcPort=8092
# 环境变量 NEXUS_CAMERA_STATUS_TRANSPORT=grpc 才启用；默认 dds（保持现有 DDS 不动）
# ──────────────────────────────────────────────────────────────────

def resolve_camera_status_transport(raw: str | None = None) -> str:
    """归一化相机状态通道：dds | grpc"""
    mode = (
        raw if raw is not None
        else os.environ.get("NEXUS_CAMERA_STATUS_TRANSPORT", "dds")
    ).strip().lower()
    return "grpc" if mode in ("grpc", "entity_status_grpc", "entity_grpc") else "dds"


def build_camera_status_grpc_receivers(settings: Settings | None = None) -> List[Dict[str, Any]]:
    """camServer EntityStatusService gRPC 订阅（相机实时 PTZ/FOV）。
    地址由 NEXUS_CAMERA_ENTITY_GRPC_URL 控制，默认本机 8092（camServer SiteProfile.ini EntityStatusGrpcPort）。
    """
    s = settings or get_settings()
    host, port = _split_host_port(
        os.environ.get("NEXUS_CAMERA_ENTITY_GRPC_URL", ""),
        "192.168.18.141",
        8092,
    )
    return [
        {
            "id": "grpc_camera_entity",
            "name": "camServer 相机实时状态 EntityStatus gRPC",
            "host": host,
            "port": port,
            "enabled": False,   # 由 apply_camera_status_transport 按 env var 开关
        }
    ]


def apply_camera_status_transport(
    dds_receivers: List[Dict[str, Any]],
    grpc_receivers: List[Dict[str, Any]],
    mode: str | None = None,
) -> str:
    """按 NEXUS_CAMERA_STATUS_TRANSPORT 启用 DDS 或 gRPC 相机状态订阅（二选一）。"""
    resolved = resolve_camera_status_transport(mode)
    use_grpc = resolved == "grpc"
    for rec in dds_receivers:
        if rec.get("id") in ("dds_camera_status", "dds_camera_status_legacy"):
            rec["enabled"] = not use_grpc
    for rec in grpc_receivers:
        rec["enabled"] = use_grpc
    return resolved


CAMERA_STATUS_GRPC_RECEIVERS = build_camera_status_grpc_receivers()
CAMERA_STATUS_TRANSPORT = apply_camera_status_transport(
    DDS_RECEIVERS, CAMERA_STATUS_GRPC_RECEIVERS
)


def resolve_fusion_track_transport(raw: str | None = None) -> str:
    """归一化对空/对海融合航迹通道：dds | grpc"""
    if raw is not None:
        mode = raw
    else:
        mode = os.environ.get("NEXUS_FUSION_TRACK_TRANSPORT")
        if not mode:
            mode = get_settings().NEXUS_FUSION_TRACK_TRANSPORT
    mode = (mode or "dds").strip().lower()
    if mode in ("grpc", "new_track_struct_grpc", "new_track_struct", "track_grpc"):
        return "grpc"
    return "dds"


def build_new_track_struct_grpc_receivers(settings: Settings | None = None) -> List[Dict[str, Any]]:
    """TrackManager NewTrackStruct gRPC 订阅源（空/海同流，按 environment 分流）。"""
    s = settings or get_settings()
    host, port = _split_host_port(
        s.NEXUS_NEW_TRACK_STRUCT_GRPC_URL, "192.168.18.141", 60055
    )
    return [
        {
            "id": "new_track_struct_grpc_client",
            "name": "TrackManager NewTrackStruct gRPC 航迹",
            "host": host,
            "port": port,
            "enabled": True,
            "method": "Subscribe",
            "reconnect_interval": 2.0,
        },
    ]


def build_virtual_new_track_struct_grpc_receivers(
    settings: Settings | None = None,
) -> List[Dict[str, Any]]:
    """蓝方虚兵 NewTrackStruct gRPC：独立一路，不随 NEXUS_FUSION_TRACK_TRANSPORT 开关。"""
    s = settings or get_settings()
    host, port = _split_host_port(
        s.NEXUS_VIRTUAL_NEW_TRACK_STRUCT_GRPC_URL, "192.168.18.116", 50065
    )
    return [
        {
            "id": "virtual_new_track_struct_grpc_client",
            "name": "TrackManager NewTrackStruct gRPC 虚兵航迹",
            "host": host,
            "port": port,
            "enabled": True,
            "method": "Subscribe",
            "reconnect_interval": 2.0,
        },
    ]


def apply_fusion_track_transport(
    dds_receivers: List[Dict[str, Any]],
    grpc_receivers: List[Dict[str, Any]],
    mode: str | None = None,
) -> str:
    """按 NEXUS_FUSION_TRACK_TRANSPORT 启用 DDS 或 gRPC 融合航迹订阅。"""
    resolved = resolve_fusion_track_transport(mode)
    use_grpc = resolved == "grpc"
    for rec in dds_receivers:
        if rec.get("id") in _FUSION_DDS_RECEIVER_IDS:
            rec["enabled"] = not use_grpc
    for rec in grpc_receivers:
        rec["enabled"] = use_grpc
    return resolved


NEW_TRACK_STRUCT_GRPC_RECEIVERS = build_new_track_struct_grpc_receivers()
FUSION_TRACK_TRANSPORT = apply_fusion_track_transport(
    DDS_RECEIVERS, NEW_TRACK_STRUCT_GRPC_RECEIVERS
)
# 蓝方虚兵 gRPC：独立列表，不受上面融合 dds/grpc 切换影响
VIRTUAL_NEW_TRACK_STRUCT_GRPC_RECEIVERS = build_virtual_new_track_struct_grpc_receivers()


def resolve_track_alarm_transport(raw: str | None = None) -> str:
    """航迹类告警通道：embedded（目标.alarms）| dds（AlarmEventTopic）。"""
    if raw is not None:
        mode = raw
    else:
        mode = os.environ.get("NEXUS_TRACK_ALARM_TRANSPORT")
        if not mode:
            mode = get_settings().NEXUS_TRACK_ALARM_TRANSPORT
    mode = (mode or "embedded").strip().lower()
    if mode in ("dds", "alarmevent", "alarm_event", "alarm-event"):
        return "dds"
    return "embedded"


def apply_track_alarm_transport(
    dds_receivers: List[Dict[str, Any]],
    mode: str | None = None,
) -> str:
    """按 NEXUS_TRACK_ALARM_TRANSPORT 开关 dds_alarm_event；embedded 时保留配置但 enabled=False。"""
    resolved = resolve_track_alarm_transport(mode)
    use_dds = resolved == "dds"
    for rec in dds_receivers:
        if rec.get("id") == "dds_alarm_event":
            rec["enabled"] = use_dds
    return resolved


TRACK_ALARM_TRANSPORT = apply_track_alarm_transport(DDS_RECEIVERS)


def resolve_radar_track_transport(raw: str | None = None) -> str:
    """归一化传感器旁路航迹通道（FusionTrack 可替代的 DDS/UDP）：dds | grpc"""
    if raw is not None:
        mode = raw
    else:
        mode = os.environ.get("NEXUS_RADAR_TRACK_TRANSPORT")
        if not mode:
            mode = get_settings().NEXUS_RADAR_TRACK_TRANSPORT
    mode = (mode or "dds").strip().lower()
    if mode in ("grpc", "fusion_track", "fusion_track_grpc", "track_grpc"):
        return "grpc"
    return "dds"


# 与 parsers.fusion_track_grpc_parser.FUSION_TRACK_DATASOURCE_TO_LAYER 保持一致（启动时解析白名单用）
# 已知源可映射到稳定图层键；未知源在配置里裸写 id 时自动 layer=id（无需改代码）。
_FUSION_TRACK_DATASOURCE_CATALOG: Dict[str, str] = {
    "yuan_yao": "radar_wharf",
    "jing_zi_tou": "radar_jingzi",
    "udp_xpf_track": "xpf_track",
    "udp_boatself_track": "boat_self_track",
    "ais": "ais_track",
    "tan_niao": "bird_radar",
    "zi_bao_wei": "uav_pose_track",
    "udp_fanwucar_track": "fanwu_car_radar",
    "ku_lei_da": "ku_lei_da",
    "auto_bird": "auto_bird_radar",
}

# 未在配置写 |显示名 时的回退中文名
_FUSION_TRACK_DATASOURCE_LABELS: Dict[str, str] = {
    "yuan_yao": "远遥码头雷达",
    "jing_zi_tou": "靖子头雷达",
    "udp_xpf_track": "远遥鹏飞",
    "udp_boatself_track": "船只自报位",
    "ais": "AIS",
    "tan_niao": "探鸟雷达",
    "zi_bao_wei": "自报位",
    "udp_fanwucar_track": "反无车",
    "ku_lei_da": "Ku雷达",
    "auto_bird": "探鸟智能跟踪",
    "tian_ao": "天鳌",
    "wu_ren_che": "无人车",
    "radar_wharf": "远遥码头雷达",
    "radar_jingzi": "靖子头雷达",
    "xpf_track": "远遥鹏飞",
    "boat_self_track": "船只自报位",
    "ais_track": "AIS",
    "bird_radar": "探鸟雷达",
    "uav_pose_track": "自报位",
    "fanwu_car_radar": "反无车",
    "auto_bird_radar": "探鸟智能跟踪",
}

_LAYER_KEY_RE = re.compile(r"^[a-z][a-z0-9_]*$", re.I)


def _raw_fusion_track_grpc_sources(raw: str | None, settings: Settings | None) -> str:
    if raw is not None:
        return (raw or "").strip()
    env = os.environ.get("NEXUS_FUSION_TRACK_GRPC_SOURCES")
    if env is None or env == "":
        env = (settings or get_settings()).NEXUS_FUSION_TRACK_GRPC_SOURCES
    return (env or "").strip()


def parse_fusion_track_grpc_sources(
    raw: str | None = None,
    settings: Settings | None = None,
) -> List[Dict[str, str]]:
    """解析 NEXUS_FUSION_TRACK_GRPC_SOURCES → [{dataSourceId, layerKey, label}, ...]。

    单项格式：
    - id
    - id|显示名
    - id:layerKey
    - id:layerKey|显示名
    - id:中文名（冒号后非英文图层键时视为显示名）
    """
    text = _raw_fusion_track_grpc_sources(raw, settings)
    text = text.strip().strip("\"'").strip()
    if not text or text.lower() in ("*", "all"):
        return [
            {
                "dataSourceId": ds,
                "layerKey": layer,
                "label": _FUSION_TRACK_DATASOURCE_LABELS.get(layer)
                or _FUSION_TRACK_DATASOURCE_LABELS.get(ds)
                or f"{ds}航迹",
            }
            for ds, layer in _FUSION_TRACK_DATASOURCE_CATALOG.items()
        ]

    out: List[Dict[str, str]] = []
    seen: set[str] = set()
    for part in re.split(r"[,\n\r]+", text):
        token = part.strip()
        if not token:
            continue
        label_from_pipe: str | None = None
        rest = token
        if "|" in rest:
            left, right = rest.split("|", 1)
            rest = left.strip()
            label_from_pipe = right.strip() or None
        if not rest:
            continue

        label_from_colon: str | None = None
        if ":" in rest:
            ds, right = rest.split(":", 1)
            ds, right = ds.strip(), right.strip()
            if not ds or not right:
                continue
            if _LAYER_KEY_RE.match(right):
                data_source_id, layer_key = ds, right
            else:
                data_source_id = ds
                layer_key = _FUSION_TRACK_DATASOURCE_CATALOG.get(ds, ds)
                label_from_colon = right
        else:
            data_source_id = rest
            layer_key = _FUSION_TRACK_DATASOURCE_CATALOG.get(rest, rest)

        label = (
            label_from_pipe
            or label_from_colon
            or _FUSION_TRACK_DATASOURCE_LABELS.get(layer_key)
            or _FUSION_TRACK_DATASOURCE_LABELS.get(data_source_id)
            or f"{data_source_id}航迹"
        )
        dedupe = f"{data_source_id}::{layer_key}"
        if dedupe in seen:
            continue
        seen.add(dedupe)
        out.append(
            {
                "dataSourceId": data_source_id,
                "layerKey": layer_key,
                "label": label,
            }
        )
    return out


def resolve_fusion_track_grpc_datasource_layer_map(
    raw: str | None = None,
    settings: Settings | None = None,
) -> Dict[str, str]:
    """解析 → {dataSourceId: track_layer_key}。"""
    return {
        row["dataSourceId"]: row["layerKey"]
        for row in parse_fusion_track_grpc_sources(raw, settings)
    }


def resolve_fusion_track_grpc_datasource_label_map(
    raw: str | None = None,
    settings: Settings | None = None,
) -> Dict[str, str]:
    """解析 → {dataSourceId|layerKey: 显示名}。"""
    out: Dict[str, str] = {}
    for row in parse_fusion_track_grpc_sources(raw, settings):
        out[row["dataSourceId"]] = row["label"]
        out[row["layerKey"]] = row["label"]
    return out


def fusion_track_source_display_name(
    data_source_id: str,
    layer_key: str = "",
    label_map: Dict[str, str] | None = None,
) -> str:
    ds = (data_source_id or "").strip()
    lk = (layer_key or "").strip()
    labels = label_map if label_map is not None else resolve_fusion_track_grpc_datasource_label_map()
    if ds and ds in labels:
        return labels[ds]
    if lk and lk in labels:
        return labels[lk]
    if ds and ds in _FUSION_TRACK_DATASOURCE_LABELS:
        return _FUSION_TRACK_DATASOURCE_LABELS[ds]
    if lk and lk in _FUSION_TRACK_DATASOURCE_LABELS:
        return _FUSION_TRACK_DATASOURCE_LABELS[lk]
    return ds or lk or "旁路航迹"


def build_fusion_track_grpc_receivers(settings: Settings | None = None) -> List[Dict[str, Any]]:
    """FusionTrack gRPC(:60056) 统一航迹流（传感器旁路：雷达/AIS/探鸟/自报位/反无车等）。"""
    s = settings or get_settings()
    host, port = _split_host_port(
        s.NEXUS_FUSION_TRACK_STREAM_GRPC_URL, "192.168.18.141", 60056
    )
    parsed = parse_fusion_track_grpc_sources(settings=s)
    datasource_layer_map = {row["dataSourceId"]: row["layerKey"] for row in parsed}
    datasource_label_map = {}
    for row in parsed:
        datasource_label_map[row["dataSourceId"]] = row["label"]
        datasource_label_map[row["layerKey"]] = row["label"]
    return [
        {
            "id": "fusion_track_grpc_client",
            "name": "FusionTrack gRPC 传感器航迹",
            "host": host,
            "port": port,
            "enabled": True,
            "method": "Subscribe",
            "reconnect_interval": 2.0,
            "datasource_layer_map": datasource_layer_map,
            "datasource_label_map": datasource_label_map,
        },
    ]


def apply_radar_track_transport(
    dds_receivers: List[Dict[str, Any]],
    grpc_receivers: List[Dict[str, Any]],
    mode: str | None = None,
    udp_receivers: List[Dict[str, Any]] | None = None,
) -> str:
    """按 NEXUS_RADAR_TRACK_TRANSPORT 启用 DDS/UDP 或 FusionTrack gRPC（二选一，防双点）。

    grpc 时关闭：远遥/靖子头/鹏飞/船自报/AIS/探鸟/无人机自报位/反无车 DDS，
    以及探鸟智能跟踪 UDP。
    """
    resolved = resolve_radar_track_transport(mode)
    use_grpc = resolved == "grpc"
    for rec in dds_receivers:
        if rec.get("id") in _RADAR_DDS_RECEIVER_IDS:
            rec["enabled"] = not use_grpc
    for rec in udp_receivers or []:
        if rec.get("id") in _RADAR_UDP_RECEIVER_IDS:
            rec["enabled"] = not use_grpc
    for rec in grpc_receivers:
        rec["enabled"] = use_grpc
    return resolved


FUSION_TRACK_STREAM_GRPC_RECEIVERS = build_fusion_track_grpc_receivers()
RADAR_TRACK_TRANSPORT = apply_radar_track_transport(
    DDS_RECEIVERS,
    FUSION_TRACK_STREAM_GRPC_RECEIVERS,
    udp_receivers=UDP_RECEIVERS,
)
