"""
DDS数据发布器
基于TrackPublisher，支持动态配置
"""
import os
import time
import tempfile
from threading import Condition
from typing import Optional, Dict
from loguru import logger

try:
    import fastdds
    import sys
    import os
    import ctypes
    
    # 添加dds目录到Python路径
    dds_dir = os.path.dirname(os.path.abspath(__file__))
    if dds_dir not in sys.path:
        sys.path.insert(0, dds_dir)
    
    # 使用 ctypes 预加载共享库（这样可以绕过 LD_LIBRARY_PATH 限制）
    so_file = os.path.join(dds_dir, "libTrackRealTimeStatus.so")
    if os.path.exists(so_file):
        try:
            ctypes.CDLL(so_file, mode=ctypes.RTLD_GLOBAL)
            logger.info(f"✅ 预加载库成功: {so_file}")
        except Exception as e:
            logger.warning(f"⚠️ 预加载库失败: {e}")
    
    import TrackRealTimeStatus
    logger.success("✅ FastDDS 库加载成功！")
    DDS_AVAILABLE = True
except ImportError as e:
    logger.error(f"❌ FastDDS库导入失败!")
    logger.error(f"❌ 错误类型: {type(e).__name__}")
    logger.error(f"❌ 错误信息: {e}")
    import traceback
    logger.error(f"❌ 完整堆栈:\n{traceback.format_exc()}")
    DDS_AVAILABLE = False
except Exception as e:
    logger.error(f"❌ 未知错误: {e}")
    import traceback
    logger.error(f"❌ 完整堆栈:\n{traceback.format_exc()}")
    DDS_AVAILABLE = False

from .xml_config_generator import DDSXMLConfigGenerator

# 保持与TrackPublisher.py一致的常量定义
DESCRIPTION = """TrackData Publisher example for Fast DDS python bindings"""
USAGE = ('python3 dds_publisher.py')


class TrackWriterListener(fastdds.DataWriterListener if DDS_AVAILABLE else object):
    """DDS数据写入监听器（保持原有逻辑不变）"""
    
    def __init__(self, writer):
        """
        初始化监听器
        
        Args:
            writer: DDSPublisher实例
        """
        self._writer = writer
        if DDS_AVAILABLE:
            super().__init__()
    
    def on_publication_matched(self, datawriter, info):
        """发布匹配回调"""
        if not DDS_AVAILABLE:
            return
            
        if (0 < info.current_count_change):
            logger.info(f"✅ DDS发布者匹配到订阅者 {info.last_subscription_handle}")
            self._writer._cvDiscovery.acquire()
            self._writer._matched_reader += 1
            self._writer._cvDiscovery.notify()
            self._writer._cvDiscovery.release()
        else:
            logger.info(f"❌ DDS发布者断开订阅者 {info.last_subscription_handle}")
            self._writer._cvDiscovery.acquire()
            self._writer._matched_reader -= 1
            self._writer._cvDiscovery.notify()
            self._writer._cvDiscovery.release()


class DDSPublisher:
    """DDS数据发布器（支持动态配置）"""
    
    def __init__(
        self,
        domain_id: int = 142,
        topic_name: str = "testtopic",
        profile_name: str = "track_publisher_client",
        discovery_server_ip: str = "192.168.18.141",
        discovery_server_port: int = 11611,
        multicast_ip: str = "239.255.0.1",
        multicast_port: int = 12359,
        xml_config_path: Optional[str] = None
    ):
        """
        初始化DDS发布器
        
        Args:
            domain_id: DDS域ID
            topic_name: 主题名称
            profile_name: 配置文件名称
            discovery_server_ip: 发现服务器IP
            discovery_server_port: 发现服务器端口
            multicast_ip: 组播IP
            multicast_port: 组播端口
            xml_config_path: XML配置文件路径（如果为None，则自动生成）
        """
        if not DDS_AVAILABLE:
            raise ImportError("FastDDS库未安装，无法创建DDS发布器")
        
        self.domain_id = domain_id
        self.topic_name = topic_name
        self.profile_name = profile_name
        self._matched_reader = 0
        self._cvDiscovery = Condition()
        self.track_id = 1000  # 起始航迹ID
        
        # 生成或使用XML配置文件
        if xml_config_path is None:
            # 自动生成XML配置文件，保存到dds目录下的xml_configs子目录
            dds_dir = os.path.dirname(os.path.abspath(__file__))
            xml_dir = os.path.join(dds_dir, 'xml_configs')
            # 确保目录存在
            os.makedirs(xml_dir, exist_ok=True)
            # 使用topic_name和domain_id生成唯一的文件名，避免多个发布器冲突
            safe_topic_name = topic_name.replace('/', '_').replace('\\', '_')
            xml_config_path = os.path.join(xml_dir, f"dds_publisher_{safe_topic_name}_{domain_id}_{profile_name}.xml")
            
            DDSXMLConfigGenerator.generate_publisher_xml(
                profile_name=profile_name,
                discovery_server_ip=discovery_server_ip,
                discovery_server_port=discovery_server_port,
                multicast_ip=multicast_ip,
                multicast_port=multicast_port,
                output_path=xml_config_path
            )
        
        self.xml_config_path = xml_config_path
        
        # 初始化DDS组件
        self._init_dds()
        
        logger.info(
            f"✅ DDS发布器初始化成功 | "
            f"域ID: {domain_id} | 主题: {topic_name} | "
            f"配置: {profile_name} | XML: {xml_config_path}"
        )
    
    def _init_dds(self):
        """初始化DDS组件（保持TrackPublisher原有逻辑）"""
        factory = fastdds.DomainParticipantFactory.get_instance()
        self.participant_qos = fastdds.DomainParticipantQos()
        factory.get_default_participant_qos(self.participant_qos)
        
        # 加载XML配置文件
        factory.load_XML_profiles_file(self.xml_config_path)
        
        # 使用配置文件创建参与者
        self.participant = factory.create_participant_with_profile(
            self.domain_id,
            self.profile_name
        )
        
        if self.participant is None:
            raise RuntimeError("DDS参与者初始化失败")
        
        # 注册数据类型（先检查是否已注册，避免重复注册错误）
        self.topic_data_type = TrackRealTimeStatus.TrackDataClassPubSubType()
        type_name = "TrackDataClassDataType"
        self.topic_data_type.set_name(type_name)
        self.type_support = fastdds.TypeSupport(self.topic_data_type)
        
        # 检查类型是否已在此 participant 上注册
        # find_type 返回空 TypeSupport 如果未找到，通过 empty() 或直接 try 注册
        try:
            self.participant.register_type(self.type_support)
        except Exception:
            # 类型已注册，忽略错误
            pass
        
        # 创建主题
        self.topic_qos = fastdds.TopicQos()
        self.participant.get_default_topic_qos(self.topic_qos)
        self.topic = self.participant.create_topic(
            self.topic_name,
            self.topic_data_type.get_name(),
            self.topic_qos
        )
        
        # 创建发布者
        self.publisher_qos = fastdds.PublisherQos()
        self.participant.get_default_publisher_qos(self.publisher_qos)
        self.publisher = self.participant.create_publisher(self.publisher_qos)
        
        # 创建监听器
        self.listener = TrackWriterListener(self)
        
        # 创建数据写入器
        self.writer_qos = fastdds.DataWriterQos()
        self.publisher.get_default_datawriter_qos(self.writer_qos)
        self.writer = self.publisher.create_datawriter(
            self.topic,
            self.writer_qos,
            self.listener
        )
        
        logger.info("✅ DDS组件初始化成功")
    
    def write(self, track_data: Optional[Dict] = None):
        """
        发布航迹数据
        
        Args:
            track_data: 航迹数据字典，如果为None则使用默认测试数据
        """
        if not DDS_AVAILABLE:
            return
            
        data = TrackRealTimeStatus.TrackDataClass()
        
        if track_data:
            # 使用提供的数据
            self._fill_track_data(data, track_data)
        else:
            # 使用默认测试数据（只设置trackId）
            data.trackId(self.track_id)
            self.track_id += 1
        
        # 发布数据
        self.writer.write(data)
        # print("dds_publish:",track_data)
        logger.debug(f"📤 DDS发布航迹数据: trackId={data.trackId()}")
    
    def _fill_track_data(self, data, track_data: Dict):
        """
        填充航迹数据到DDS对象
        
        Args:
            data: TrackDataClass对象
            track_data: 航迹数据字典
        """
        def _to_uint32(value):
            """将值转换为 uint32_t（0 到 4294967295）"""
            if value is None:
                return 0
            if value > 4294967295:
                return value & 0xFFFFFFFF  # 取低32位
            elif value < 0:
                return 0
            return int(value)
        
        def _to_uint64(value):
            """将值转换为 uint64_t（64位无符号整数）"""
            if value is None:
                return 0
            if value < 0:
                return 0
            return int(value)
        
        # 设置所有字段（如果存在）
        # trackId 和 uniqueId 是 64 位的
        if 'trackId' in track_data:
            data.trackId(_to_uint64(track_data['trackId']))
        if 'mmsi' in track_data:
            data.mmsi(_to_uint32(track_data['mmsi']))
        if 'uniqueId' in track_data:
            data.uniqueId(_to_uint64(track_data['uniqueId']))
        if 'longitude' in track_data:
            data.longitude(track_data['longitude'])
        if 'latitude' in track_data:
            data.latitude(track_data['latitude'])
        if 'course' in track_data:
            data.course(track_data['course'])
        if 'distance' in track_data:
            data.distance(track_data['distance'])
        if 'speed' in track_data:
            data.speed(track_data['speed'])
        if 'speed_N' in track_data:
            data.speed_N(track_data['speed_N'])
        if 'speed__E' in track_data:
            data.speed__E(track_data['speed__E'])
        if 'speed_V' in track_data:
            data.speed_V(track_data['speed_V'])
        if 'height' in track_data:
            data.height(track_data['height'])
        if 'azimuth' in track_data:
            data.azimuth(track_data['azimuth'])
        if 'range' in track_data:
            data.range(track_data['range'])
        if 'sizeMetres' in track_data:
            data.sizeMetres(track_data['sizeMetres'])
        if 'sizeDegrees' in track_data:
            data.sizeDegrees(track_data['sizeDegrees'])
        if 'radarId' in track_data:
            data.radarId(track_data['radarId'])
        if 'dotID' in track_data:
            data.dotID(_to_uint32(track_data['dotID']))
        if 'trackQuality' in track_data:
            data.trackQuality(track_data['trackQuality'])
        if 'fusion' in track_data:
            data.fusion(track_data['fusion'])
        if 'sensors' in track_data:
            data.sensors(_to_uint32(track_data['sensors']))
        if 'trackID' in track_data and isinstance(track_data['trackID'], list):
            # trackID是std::array<uint32_t, 8>，需要先获取数组引用，然后设置每个元素
            track_id_array = data.trackID()  # 获取数组引用
            track_id_list = track_data['trackID'][:8]  # 最多8个
            # 确保数组有8个元素，不足的用0填充
            while len(track_id_list) < 8:
                track_id_list.append(0)
            # 通过数组引用设置每个元素，并确保每个元素都是 uint32_t
            for i, tid in enumerate(track_id_list):
                track_id_array[i] = _to_uint32(tid)
        if 'timeStamp' in track_data:
            data.timeStamp(_to_uint32(track_data['timeStamp']))
        if 'threatScore' in track_data:
            data.threatScore(track_data['threatScore'])
        if 'threatLevel' in track_data:
            data.threatLevel(track_data['threatLevel'])
        if 'trackCategoryId' in track_data:
            data.trackCategoryId(track_data['trackCategoryId'])
        if 'trackCategoryName' in track_data:
            data.trackCategoryName(track_data['trackCategoryName'])
        if 'trackAlias' in track_data:
            data.trackAlias(track_data['trackAlias'])
        if 'isManual' in track_data:
            # 确保转换为 bool 类型（C++ 绑定要求）
            is_manual = bool(track_data['isManual']) if track_data['isManual'] is not None else False
            data.isManual(is_manual)
        if 'modifiedBy' in track_data:
            data.modifiedBy(track_data['modifiedBy'])
        if 'modifiedTime' in track_data:
            data.modifiedTime(track_data['modifiedTime'])
        
        # 保留字段（IDL结构只有reserved0-reserved6）
        if 'reserved0' in track_data:
            data.reserved0(track_data['reserved0'])
        if 'reserved1' in track_data:
            data.reserved1(track_data['reserved1'])
        if 'reserved2' in track_data:
            data.reserved2(track_data['reserved2'])
        if 'reserved3' in track_data:
            data.reserved3(track_data['reserved3'])
        if 'reserved4' in track_data:
            data.reserved4(_to_uint32(track_data['reserved4']))  # reid
        if 'reserved5' in track_data:
            data.reserved5(_to_uint32(track_data['reserved5']))
        if 'reserved6' in track_data:
            data.reserved6(str(track_data['reserved6']) if track_data['reserved6'] else "")
    
    def wait_discovery(self, timeout: Optional[float] = None):
        """
        等待发现订阅者
        
        Args:
            timeout: 超时时间（秒），如果为None则无限等待
        """
        self._cvDiscovery.acquire()
        logger.info("⏳ DDS发布者等待发现订阅者...")
        
        if timeout:
            self._cvDiscovery.wait_for(lambda: self._matched_reader != 0, timeout=timeout)
        else:
            self._cvDiscovery.wait_for(lambda: self._matched_reader != 0)
        
        self._cvDiscovery.release()
        
        if self._matched_reader > 0:
            logger.info(f"✅ DDS发布者已发现 {self._matched_reader} 个订阅者")
        else:
            logger.warning("⚠️ DDS发布者未发现订阅者")
    
    def run(self, interval: float = 1.0):
        """
        运行发布器（阻塞模式，定期发布测试数据）
        
        Args:
            interval: 发布间隔（秒）
        """
        self.wait_discovery()
        try:
            while True:
                time.sleep(interval)
                self.write()
        except KeyboardInterrupt:
            logger.info("⚠️ 发布器被用户停止")
        finally:
            self.delete()
    
    def delete(self):
        """清理DDS资源"""
        if not DDS_AVAILABLE:
            return
            
        try:
            factory = fastdds.DomainParticipantFactory.get_instance()
            self.participant.delete_contained_entities()
            factory.delete_participant(self.participant)
            logger.info("✅ DDS发布器资源已清理")
        except Exception as e:
            logger.error(f"❌ 清理DDS发布器资源失败: {e}")
    
    @staticmethod
    def is_available() -> bool:
        """检查DDS是否可用"""
        return DDS_AVAILABLE
