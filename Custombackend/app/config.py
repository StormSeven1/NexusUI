"""
配置模块 - 数据接收和服务配置
"""
# EO 视频/检测框链路说明
# - 后端本身不代理实时 WebRTC 视频流。
# - 实体实时数据里会携带 `videoAddress` 或 `media.address`。
# - 前端会把这两个字段归一化成 `sensor_video_url`，然后直接发起 WebRTC 播放。
# - 后端负责把 DDS 检测结果转发给前端 WebSocket 客户端。
# - EO 弹窗当前依赖的检测 DDS 主题有两类：
#   - `dds_shore_multi_detection` -> `MultiTrackResultTopic`
#   - `dds_shore_single_detection` -> `SingleTrackResultTopic`
# - 注册区域/航线由后端存库后统一广播给前端，广播消息类型是 `DbAreas`。

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
    # 实体注册地址，只允许 Custombackend 在后端侧调用。
    # 完整流程：
    # 1. 前端把新建区域/航线提交到 Custombackend `/api/areas`
    # 2. Custombackend 先写入 `area_table`
    # 3. Custombackend 再根据数据库行构造区域/航线实体 payload
    # 4. 最后由 Custombackend 向这个地址发起 POST 完成实体注册
    # 浏览器前端不应该知道这个地址，也不应该直接调用它。
    ENTITY_PUBLISH_URL: str = "http://192.168.18.141:8090/api/v1/publishEntity"

    # 实体删除地址模板，也只允许 Custombackend 在后端侧调用。
    # `{entityId}` 会在运行时替换成：
    # - `area-<groupId>-<areaId>`
    # - `route-<groupId>-<areaId>`
    # 删除流程：
    # 1. 前端先请求 Custombackend 删除区域/航线
    # 2. Custombackend 先调这个地址删除已发布实体
    # 3. 再删除 `area_table` 里的数据库行
    # 4. 最后刷新后端缓存，并广播最新 `DbAreas` 快照给所有客户端
    ENTITY_DELETE_URL_TEMPLATE: str = "http://192.168.18.141:8090/api/v1/entities/{entityId}"

    # 注册区域/航线的 WebSocket 广播消息类型。
    # 这是数据库区域在前端的唯一正式事实来源：
    # - 后端启动时先从 Postgres 加载一次当前快照
    # - 每个客户端连上 WebSocket 后先收到一份全量快照
    # - 每次新增/删除区域后，后端重新构建快照并再次广播
    # 前端 `db-area-store` 只依赖这个消息类型渲染，不再直接轮询数据库。
    DB_AREA_BROADCAST_TYPE: str = "DbAreas"

    # EO 视频截图保存根目录。
    # 前端 EO 弹窗会把当前画面抓成图片，再通过
    # `POST /eo-video/capture/save?kind=snapshot`
    # 把二进制内容上传到后端。
    # 后端最终会把文件保存到：
    # `<EO_VIDEO_CAPTURE_PIC_DIR>/<streamLabel>/<fileName>`
    # 这只是本地归档路径，不参与实时 WebRTC 播放。
    EO_VIDEO_CAPTURE_PIC_DIR: str = r".\data\eo-video\snapshot"

    # EO 视频录像保存根目录。
    # 前端浏览器会先在内存里录制 WebM 片段，再通过
    # `POST /eo-video/capture/save?kind=record`
    # 上传给后端保存。
    # 后端最终会把文件保存到：
    # `<EO_VIDEO_CAPTURE_VIDEO_DIR>/<streamLabel>/<fileName>`
    # 这同样只是导出/归档路径，不参与实时视频播放。
    EO_VIDEO_CAPTURE_VIDEO_DIR: str = r".\data\eo-video\record"
    
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
    {
        "id": "udp_speed_camera",
        "name": "高速相机检测(UDP)",
        "type": "multicast",
        "host": "239.192.110.99",
        "port": 8568,
        "enabled": True,
        "data_format": "SpeedCamera",
    }
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
        "domain_id": 200,
        "topic_name": "CameraRealTimeStatusTopic",
        "profile_name": "camera_subscriber_client",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12359,
        "dds_module_path": "./DDSReferences/EntityRealTimeStatus/build",
        "dds_module_name": "EntityRealTimeStatus",
        "structure_type": "camera_status",
        "data_class_name": "CameraRealTimeStatus",
        "pubsub_type_class_name": "CameraRealTimeStatusPubSubType",
        "type_name": "casia::device::status::CameraStatus::CameraRealTimeStatus",
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
   # === TrackManager 转发的融合航迹（NewStruct TargetOutputSet） ===
    {
        "id": "dds_forward_fuse_track",
        "name": "融合航迹",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "TrackTopic_NewStruct_FuseTrack",
        "profile_name": "track_subscriber_newstruct",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12370,
        "dds_module_path": "./DDSReferences/NewTrackStruct/build",
        "structure_type": "new_track_struct",
        "dds_module_name": "NewTrackRealTimeStatus",
        "data_class_name": "TargetOutputSet",
        "pubsub_type_class_name": "TargetOutputSetPubSubType",
        "type_name": "TargetMinimal::TargetOutputSet",
        "use_default_xml": False
    },
        {
        "id": "dds_forward_fuse_track",
        "name": "融合航迹",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "TrackTopic_NewStruct_FuseTrack_virtual",
        "profile_name": "track_subscriber_newstruct",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/NewTrackStruct/build",
        "structure_type": "new_track_struct",
        "dds_module_name": "NewTrackRealTimeStatus",
        "data_class_name": "TargetOutputSet",
        "pubsub_type_class_name": "TargetOutputSetPubSubType",
        "type_name": "TargetMinimal::TargetOutputSet",
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
        "topic_name": "TrackTopic_NewStruct_FuseBirdTrack",
        "profile_name": "track_subscriber_newstruct",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12370,
        "dds_module_path": "./DDSReferences/NewTrackStruct/build",
        "structure_type": "new_track_struct",
        "dds_module_name": "NewTrackRealTimeStatus",
        "data_class_name": "TargetOutputSet",
        "pubsub_type_class_name": "TargetOutputSetPubSubType",
        "type_name": "TargetMinimal::TargetOutputSet",
        "use_default_xml": False
    },
     {
        "id": "dds_forward_fuse_bird_radar_track",
        "name": "对空融合航迹",
        "enabled": True,
        "domain_id": 141,
        "topic_name": "TrackTopic_NewStruct_FuseBirdTrack_virtual",
        "profile_name": "track_subscriber_newstruct",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/NewTrackStruct/build",
        "structure_type": "new_track_struct",
        "dds_module_name": "NewTrackRealTimeStatus",
        "data_class_name": "TargetOutputSet",
        "pubsub_type_class_name": "TargetOutputSetPubSubType",
        "type_name": "TargetMinimal::TargetOutputSet",
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
        "enabled": True,
        "domain_id": 200,
        "topic_name": "dock2RealTimeStatusTopic",
        "profile_name": "test_dock_client",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/EntityRealTimeStatus/build",
        "dds_module_name": "EntityRealTimeStatus",
        "structure_type": "dock_status",
        "data_class_name": "Dock2RealTimeStatus",
        "pubsub_type_class_name": "Dock2RealTimeStatusPubSubType",
        "type_name": "casia::device::status::Dock2Status::Dock2RealTimeStatus",
        "use_default_xml": False
    },
    {
        "id": "dds_drone_status",
        "name": "无人机实时状态",
        "enabled": True,
        "domain_id": 200,
        "topic_name": "droneRealTimeStatusTopic",
        "profile_name": "test_drone_client",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/EntityRealTimeStatus/build",
        "dds_module_name": "EntityRealTimeStatus",
        "structure_type": "drone_status",
        "data_class_name": "DroneRealTimeStatus",
        "pubsub_type_class_name": "DroneRealTimeStatusPubSubType",
        "type_name": "casia::device::status::DroneGeneralStatus::DroneStatus::DroneRealTimeStatus",
        "use_default_xml": False
    },
    {
        "id": "dds_drone_task",
        "name": "无人机任务状态",
        "enabled": True,
        "domain_id": 200,
        "topic_name": "DroneTaskRealTimeStatusTopic",
        "profile_name": "test_task_client",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/EntityRealTimeStatus/build",
        "dds_module_name": "EntityRealTimeStatus",
        "structure_type": "drone_task",
        "data_class_name": "DroneTaskRealTimeStatus",
        "pubsub_type_class_name": "DroneTaskRealTimeStatusPubSubType",
        "type_name": "casia::device::status::DroneGeneralStatus::DroneTaskStatus::DroneTaskRealTimeStatus",
        "use_default_xml": False
    },
    {
        "id": "dds_high_freq",
        "name": "高频位置数据",
        "enabled": True,
        "domain_id": 200,
        "topic_name": "highFreqRealTimeStatusTopic",
        "profile_name": "test_highfreq_client",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/EntityRealTimeStatus/build",
        "dds_module_name": "EntityRealTimeStatus",
        "structure_type": "high_freq",
        "data_class_name": "highFreqRealTimeStatus",
        "pubsub_type_class_name": "highFreqRealTimeStatusPubSubType",
        "type_name": "casia::device::status::DroneGeneralStatus::DroneStatus::highFreqRealTimeStatus",
        "use_default_xml": False
    },
    {
        "id": "dds_munition_status",
        "name": "巡飞弹实时状态",
        "enabled": True,
        "domain_id": 200,
        "topic_name": "MunitionRealTimeStatusTopic",
        "profile_name": "test_munition_client",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/EntityRealTimeStatus/build",
        "dds_module_name": "EntityRealTimeStatus",
        "structure_type": "munition_status",
        "data_class_name": "MunitionRealTimeStatus",
        "pubsub_type_class_name": "MunitionRealTimeStatusPubSubType",
        "type_name": "casia::device::status::MunitionStatus::MunitionRealTimeStatus",
        "use_default_xml": False
    },
    {
        "id": "dds_usv_status",
        "name": "无人船实时状态",
        "enabled": True,
        "domain_id": 200,
        "topic_name": "usvRealTimeStatusTopic",
        "profile_name": "test_usv_client",
        "discovery_server_ip": "192.168.18.141",
        "discovery_server_port": 11611,
        "multicast_ip": "239.255.0.1",
        "multicast_port": 12355,
        "dds_module_path": "./DDSReferences/EntityRealTimeStatus/build",
        "dds_module_name": "EntityRealTimeStatus",
        "structure_type": "usv_status",
        "data_class_name": "USVRealTimeStatus",
        "pubsub_type_class_name": "USVRealTimeStatusPubSubType",
        "type_name": "casia::device::status::USVStatus::USVRealTimeStatus",
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
        "params": {"page": 1, "size": 1000},
        "auth": None
    },
    {
        "id": "entity_relationships_poller",
        "name": "实体关系轮询",
        "url": "http://192.168.18.141:8090/api/v1/relationships",
        "method": "GET",
        "poll_interval": 5.0,
        "enabled": True,
        "data_format": "EntityRelationships",
        "headers": {},
        "params": {"page": 1, "size": 2000},
        "auth": None
    },
]


def get_settings() -> Settings:
    return Settings()
