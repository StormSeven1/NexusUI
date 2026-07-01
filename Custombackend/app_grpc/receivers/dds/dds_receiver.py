"""
DDS数据接收器
基于TrackSubscriber，完全保持原有逻辑，仅添加可配置性
"""
import signal
import os
from typing import Optional, Callable, Dict
from loguru import logger

# 导入DDS相关模块
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

# 导入本地模块
from .xml_config_generator import DDSXMLConfigGenerator

# DDS数据解析函数（内联实现，避免外部依赖）
def parse_dds_object(data) -> dict:
    """解析DDS对象为字典"""
    try:
        result = {
            'track_id': str(data.trackId()),
            'unique_id': str(data.uniqueId()) if hasattr(data, 'uniqueId') else None,
            'mmsi': data.mmsi() if hasattr(data, 'mmsi') else None,
            'longitude': data.longitude(),
            'latitude': data.latitude(),
            'altitude': data.height() if hasattr(data, 'height') else 0,
            'speed': data.speed(),
            'course': data.course(),
            'azimuth': data.azimuth() if hasattr(data, 'azimuth') else 0,
            'distance': data.distance() if hasattr(data, 'distance') else 0,
            'timestamp': data.timeStamp() if hasattr(data, 'timeStamp') else None,
            'source': 'DDS',
            'target_type': data.trackCategoryName() if hasattr(data, 'trackCategoryName') else 'Unknown',
        }
        return result
    except Exception as e:
        logger.error(f"解析DDS对象失败: {e}")
        return None

# 保持与TrackSubscriber.py一致的常量定义
DESCRIPTION = """TrackRealTimeStatus Subscriber example for Fast DDS python bindings"""
USAGE = ('python3 dds_receiver.py')

# To capture ctrl+C
def signal_handler(sig, frame):
    print('Interrupted!')


class TrackReaderListener(fastdds.DataReaderListener if DDS_AVAILABLE else object):
    """
    DDS数据读取监听器
    完全保持TrackSubscriber.py中的原有逻辑不变
    """
    
    def __init__(self, data_callback: Optional[Callable] = None):
        """
        初始化监听器
        
        Args:
            data_callback: 数据回调函数，接收解析后的数据字典
        """
        if DDS_AVAILABLE:
            super().__init__()
        self.num = 0
        self.data_callback = data_callback
    
    def on_subscription_matched(self, datareader, info):
        """订阅匹配回调（与原始TrackSubscriber.py完全一致）"""
        if not DDS_AVAILABLE:
            return
            
        if (0 < info.current_count_change):
            print("Subscriber matched publisher {}".format(info.last_publication_handle))
        else:
            print("Subscriber unmatched publisher {}".format(info.last_publication_handle))
            self.num = 0
    
    def on_data_available(self, reader):
        """
        数据可用回调（与原始TrackSubscriber.py完全一致）
        唯一的改动是添加了数据回调机制
        """
        if not DDS_AVAILABLE:
            return
        
        # 以下代码与TrackSubscriber.py第41-46行完全一致
        info = fastdds.SampleInfo()
        data = TrackRealTimeStatus.TrackDataClass()
        reader.take_next_sample(data, info)
        self.num += 1
        print(f"Sample {self.num} RECEIVED")
        
        # 如果有回调函数，解析数据并调用
        if self.data_callback:
            try:
                # 使用 dds_track_parser 解析数据（已在模块级别导入）
                parsed_data = parse_dds_object(data)
                self.data_callback(parsed_data) 
            except Exception as e:
                logger.error(f"❌ DDS数据回调函数执行失败: {e}")
                import traceback
                logger.debug(traceback.format_exc())


class DDSReceiver:
    """DDS数据接收器（支持动态配置）"""
    
    def __init__(
        self,
        domain_id: int = 142,
        topic_name: str = "TrackDataClassTopic_FuseTrack",
        profile_name: str = "track_subscriber_client",
        discovery_server_ip: str = "192.168.18.141",
        discovery_server_port: int = 11611,
        multicast_ip: str = "239.255.0.1",
        multicast_port: int = 12359,
        data_callback: Optional[Callable] = None,
        xml_config_path: Optional[str] = None
    ):
        """
        初始化DDS接收器
        
        Args:
            domain_id: DDS域ID
            topic_name: 主题名称
            profile_name: 配置文件名称
            discovery_server_ip: 发现服务器IP
            discovery_server_port: 发现服务器端口
            multicast_ip: 组播IP
            multicast_port: 组播端口
            data_callback: 数据回调函数
            xml_config_path: XML配置文件路径（如果为None，则自动生成）
        """
        if not DDS_AVAILABLE:
            raise ImportError("FastDDS库未安装，无法创建DDS接收器")
        
        self.domain_id = domain_id
        self.topic_name = topic_name
        self.profile_name = profile_name
        self.data_callback = data_callback
        
        # 生成或使用XML配置文件
        if xml_config_path is None:
            # 自动生成XML配置文件，保存到dds目录下的xml_configs子目录
            dds_dir = os.path.dirname(os.path.abspath(__file__))
            xml_dir = os.path.join(dds_dir, 'xml_configs')
            # 确保目录存在
            os.makedirs(xml_dir, exist_ok=True)
            # 使用topic_name和domain_id生成唯一的文件名，避免多个接收器冲突
            safe_topic_name = topic_name.replace('/', '_').replace('\\', '_')
            xml_config_path = os.path.join(xml_dir, f"dds_subscriber_{safe_topic_name}_{domain_id}_{profile_name}.xml")
            
            DDSXMLConfigGenerator.generate_subscriber_xml(
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
            f"✅ DDS接收器初始化成功 | "
            f"域ID: {domain_id} | 主题: {topic_name} | "
            f"配置: {profile_name} | XML: {xml_config_path}"
        )
    
    def _init_dds(self):
        """
        初始化DDS组件
        完全保持TrackSubscriber.py中Reader.__init__的原有逻辑（第74-109行）
        """
        # 以下代码与TrackSubscriber.py第75-77行完全一致
        factory = fastdds.DomainParticipantFactory.get_instance()
        self.participant_qos = fastdds.DomainParticipantQos()
        factory.get_default_participant_qos(self.participant_qos)
        
        # 加载XML配置文件（对应第78行）
        factory.load_XML_profiles_file(self.xml_config_path)
        
        # 使用配置文件创建参与者（对应第79行）
        self.participant = factory.create_participant_with_profile(
            self.domain_id, 
            self.profile_name
        )
        # 对应第80行的注释：#self.participant = factory.create_participant(142, self.participant_qos)
        
        # 对应第82-84行
        if (self.participant == None):
            print("TrackDataClass Participant initialization failed")
            raise RuntimeError("DDS参与者初始化失败")
        
        # 注册数据类型（先检查是否已注册，避免重复注册错误）
        self.topic_data_type = TrackRealTimeStatus.TrackDataClassPubSubType()
        type_name = "TrackDataClassDataType"
        self.topic_data_type.set_name(type_name)
        self.type_support = fastdds.TypeSupport(self.topic_data_type)
        
        # 尝试注册类型，如果已注册则忽略错误
        try:
            self.participant.register_type(self.type_support)
        except Exception:
            # 类型已注册，忽略错误
            pass
        
        # 以下代码与TrackSubscriber.py第91-96行完全一致
        self.topic_qos = fastdds.TopicQos()
        self.participant.get_default_topic_qos(self.topic_qos)
        self.topic = self.participant.create_topic(
            self.topic_name,
            self.topic_data_type.get_name(),
            self.topic_qos
        )
        
        # 以下代码与TrackSubscriber.py第98-100行完全一致
        self.subscriber_qos = fastdds.SubscriberQos()
        self.participant.get_default_subscriber_qos(self.subscriber_qos)
        self.subscriber = self.participant.create_subscriber(self.subscriber_qos)
        
        # 以下代码与TrackSubscriber.py第102-108行完全一致
        self.listener = TrackReaderListener(data_callback=self.data_callback)
        self.reader_qos = fastdds.DataReaderQos()
        self.subscriber.get_default_datareader_qos(self.reader_qos)
        self.reader = self.subscriber.create_datareader(
            self.topic,
            self.reader_qos,
            self.listener
        )
        
        # 对应第109行
        print('init success')
    
    def delete(self):
        """
        清理DDS资源
        完全保持TrackSubscriber.py中Reader.delete的原有逻辑（第111-115行）
        """
        if not DDS_AVAILABLE:
            return
            
        try:
            # 以下代码与TrackSubscriber.py第112-115行完全一致
            factory = fastdds.DomainParticipantFactory.get_instance()
            self.participant.delete_contained_entities()
            factory.delete_participant(self.participant)
            self.listener.num = 0
        except Exception as e:
            logger.error(f"❌ 清理DDS接收器资源失败: {e}")
    
    def run(self):
        """运行接收器（阻塞模式）"""
        signal.signal(signal.SIGINT, self._signal_handler)
        logger.info("🚀 DDS接收器运行中，按Ctrl+C停止...")
        signal.pause()
        self.delete()
    
    def _signal_handler(self, sig, frame):
        """信号处理器"""
        logger.info("⚠️ 接收到停止信号，正在关闭DDS接收器...")
        self.delete()
    
    @staticmethod
    def is_available() -> bool:
        """检查DDS是否可用"""
        return DDS_AVAILABLE
