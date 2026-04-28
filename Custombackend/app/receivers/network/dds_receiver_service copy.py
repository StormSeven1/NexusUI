"""
DDS接收器服务

在services目录中重新实现DDS接收逻辑
- DDS模块文件夹：只存放DLL、Python绑定（.py）、.so文件
- 解析器：统一放在app/parser目录
- XML配置：动态生成
"""
import os
import sys
import ctypes
from typing import Optional, Callable, Dict
from loguru import logger

# 导入DDS相关模块
try:
    import fastdds
    from receivers.dds.xml_config_generator import DDSXMLConfigGenerator
    DDS_AVAILABLE = True
    logger.success("✅ FastDDS 库加载成功！")
except ImportError as e:
    logger.error(f"❌ FastDDS库导入失败: {e}")
    DDS_AVAILABLE = False
except Exception as e:
    logger.error(f"❌ 未知错误: {e}")
    DDS_AVAILABLE = False


class DDSReceiverService:
    """
    DDS接收器服务
    
    功能：
    - 从配置的dds_module_path加载Python绑定和DLL
    - 从app/parser目录加载解析器
    - 动态生成XML配置
    - 管理DDS接收器生命周期
    """
    
    def __init__(
        self,
        source_config: Dict,
        data_callback: Optional[Callable] = None
    ):
        """
        初始化DDS接收器服务
        
        Args:
            source_config: 数据源配置，包含dds_config
            data_callback: 数据回调函数，接收解析后的字典
        """
        if not DDS_AVAILABLE:
            raise ImportError("FastDDS库未安装，无法创建DDS接收器")
        
        self.source_config = source_config
        self.source_id = source_config['source_id']
        self.name = source_config['name']
        
        self.dds_config = source_config.get('dds_config', {})
        self.data_callback = data_callback
        
        # DDS配置参数 - 所有参数必须在配置文件中明确指定，不使用任何默认值或自动推导
        required_params = [
            'domain_id', 'topic_name', 'profile_name',
            'discovery_server_ip', 'discovery_server_port',
            'multicast_ip', 'multicast_port',
            'dds_module_path', 'structure_type', 
            'data_class_name', 'pubsub_type_class_name', 'type_name'
        ]
        
        # 检查必需参数
        missing_params = [p for p in required_params if p not in self.dds_config]
        if missing_params:
            raise ValueError(
                f"DDS接收器 [{self.source_id}] 缺少必需配置参数: {', '.join(missing_params)}\n"
                f"请在配置文件中明确指定所有DDS参数，不使用默认值或自动推导"
            )
        
        # 读取配置参数（不使用默认值，不自动推导）
        self.domain_id = self.dds_config['domain_id']
        self.topic_name = self.dds_config['topic_name']
        self.profile_name = self.dds_config['profile_name']
        self.discovery_server_ip = self.dds_config['discovery_server_ip']
        self.discovery_server_port = self.dds_config['discovery_server_port']
        self.multicast_ip = self.dds_config['multicast_ip']
        self.multicast_port = self.dds_config['multicast_port']
        
        # DDS模块路径和结构类型
        self.dds_module_path = self.dds_config['dds_module_path']
        self.structure_type = self.dds_config['structure_type']
        
        # DDS数据类名 - 必须手动配置
        self.data_class_name = self.dds_config['data_class_name']
        self.pubsub_type_class_name = self.dds_config['pubsub_type_class_name']
        self.type_name = self.dds_config['type_name']
        
        # 动态加载的DDS模块和对象
        self.dds_module = None  # 动态加载的模块
        self.dds_data_class = None
        self.pubsub_type_class = None
        self.binding_module = None
        
        # DDS组件
        self.participant = None
        self.subscriber = None
        self.reader = None
        self.listener = None
        self.xml_config_path = None
        
        # 加载DDS模块
        if self.dds_module_path:
            self._load_dds_module()
        else:
            raise ValueError(f"DDS接收器 [{self.source_id}] 未配置dds_module_path")
        
        # 生成XML配置
        self._generate_xml_config()
        
        # 初始化DDS组件
        self._init_dds()
        
        logger.info(
            f"✅ DDS接收器服务初始化成功 [{self.source_id}] | "
            f"模块: {self.dds_module_path} | 结构类型: {self.structure_type}"
        )
    
    def _load_dds_module(self):
        """根据dds_module_path动态加载DDS模块"""
        if not DDS_AVAILABLE:
            raise ImportError("FastDDS库未安装")
        
        # 打印所有配置参数用于调试
        logger.info(f"📋 DDS接收器配置参数:")
        logger.info(f"  - source_id: {self.source_id}")
        logger.info(f"  - domain_id: {self.domain_id}")
        logger.info(f"  - topic_name: {self.topic_name}")
        logger.info(f"  - profile_name: {self.profile_name}")
        logger.info(f"  - dds_module_path: {self.dds_module_path}")
        logger.info(f"  - structure_type: {self.structure_type}")
        logger.info(f"  - data_class_name: {self.data_class_name}")
        logger.info(f"  - pubsub_type_class_name: {self.pubsub_type_class_name}")
        logger.info(f"  - type_name: {self.type_name}")
        
        # 动态加载DDS模块
        if not self.dds_module_path or not os.path.exists(self.dds_module_path):
            raise ImportError(f"DDS模块路径不存在: {self.dds_module_path}")
        
        # 添加模块路径到sys.path
        if self.dds_module_path not in sys.path:
            sys.path.insert(0, self.dds_module_path)
            logger.info(f"✅ 添加模块路径到sys.path: {self.dds_module_path}")
        
        # 查找并预加载所有.so文件（按依赖顺序：先lib后wrapper）
        so_files = [f for f in os.listdir(self.dds_module_path) if f.endswith('.so')]
        # 先加载lib开头的基础库
        lib_files = [f for f in so_files if f.startswith('lib')]
        wrapper_files = [f for f in so_files if not f.startswith('lib')]
        
        for so_filename in lib_files + wrapper_files:
            so_file = os.path.join(self.dds_module_path, so_filename)
            try:
                ctypes.CDLL(so_file, mode=ctypes.RTLD_GLOBAL)
                logger.info(f"✅ 预加载共享库: {so_file}")
            except Exception as e:
                logger.debug(f"⚠️ 预加载共享库失败 [{so_filename}]: {e}")
        
        # 查找Python模块文件（通常是TrackRealTimeStatus.py或类似名称）
        py_files = [f[:-3] for f in os.listdir(self.dds_module_path) 
                   if f.endswith('.py') and not f.startswith('_')]
        
        if not py_files:
            raise ImportError(f"在 {self.dds_module_path} 中未找到Python模块文件")
        
        # 优先使用与data_class_name同名的模块文件
        if self.data_class_name in py_files:
            module_name = self.data_class_name
        else:
            module_name = py_files[0]  # 否则使用第一个找到的.py文件
        logger.info(f"🔍 尝试导入模块: {module_name} (可用模块: {py_files})")
        
        try:
            # 动态导入模块
            import importlib
            self.dds_module = importlib.import_module(module_name)
            logger.success(f"✅ 成功导入DDS模块: {module_name}")
        except Exception as e:
            raise ImportError(f"导入DDS模块失败 [{module_name}]: {e}")
        
        # 打印模块中可用的类
        available_classes = [attr for attr in dir(self.dds_module) if not attr.startswith('_')]
        logger.info(f"📦 {module_name}模块中可用的类: {available_classes[:20]}...")  # 只显示前20个
        
        # 验证数据类是否存在
        if not hasattr(self.dds_module, self.data_class_name):
            data_classes = [attr for attr in dir(self.dds_module) 
                          if not attr.startswith('_') and 'PubSubType' not in attr and not attr.startswith('eprosima')]
            raise ImportError(
                f"{module_name}模块中未找到 {self.data_class_name} 类。"
                f"请在dds_config中配置正确的data_class_name。"
                f"可用的数据类: {data_classes[:30]}"
            )
        
        # 验证PubSubType类是否存在
        if not hasattr(self.dds_module, self.pubsub_type_class_name):
            pubsub_classes = [attr for attr in dir(self.dds_module) if 'PubSubType' in attr]
            raise ImportError(
                f"{module_name}模块中未找到 {self.pubsub_type_class_name} 类。"
                f"请在dds_config中配置正确的pubsub_type_class_name。"
                f"可用的PubSubType类: {pubsub_classes}"
            )
        
        logger.success(f"✅ DDS模块验证成功: {self.data_class_name}, {self.pubsub_type_class_name}")
    
    def _generate_xml_config(self):
        """动态生成XML配置文件，保存到dds_module_path指定的路径下"""
        try:
            # 使用配置文件中指定的dds_module_path作为XML配置文件的保存路径
            xml_dir = self.dds_module_path
            os.makedirs(xml_dir, exist_ok=True)
            
            # 生成唯一的文件名
            safe_topic_name = self.topic_name.replace('/', '_').replace('\\', '_')
            self.xml_config_path = os.path.join(
                xml_dir,
                f"dds_subscriber_{safe_topic_name}_{self.domain_id}_{self.profile_name}.xml"
            )
            
            DDSXMLConfigGenerator.generate_subscriber_xml(
                profile_name=self.profile_name,
                discovery_server_ip=self.discovery_server_ip,
                discovery_server_port=self.discovery_server_port,
                multicast_ip=self.multicast_ip,
                multicast_port=self.multicast_port,
                output_path=self.xml_config_path
            )
            
            logger.info(f"✅ 生成XML配置: {self.xml_config_path}")
            
        except Exception as e:
            logger.error(f"❌ 生成XML配置失败: {e}")
            raise
    
    def _init_dds(self):
        """初始化DDS组件"""
        try:
            # 创建DomainParticipant
            factory = fastdds.DomainParticipantFactory.get_instance()
            participant_qos = fastdds.DomainParticipantQos()
            factory.get_default_participant_qos(participant_qos)
            
            # 加载XML配置文件
            factory.load_XML_profiles_file(self.xml_config_path)
            
            # 使用配置文件创建参与者
            self.participant = factory.create_participant_with_profile(
                self.domain_id,
                self.profile_name
            )
            
            if self.participant is None:
                raise RuntimeError("DDS参与者初始化失败")
            
            # 动态注册数据类型
            pubsub_type_class = getattr(self.dds_module, self.pubsub_type_class_name)
            topic_data_type = pubsub_type_class()
            topic_data_type.set_name(self.type_name)
            type_support = fastdds.TypeSupport(topic_data_type)
            
            try:
                self.participant.register_type(type_support)
            except Exception:
                pass  # 类型已注册，忽略错误
            
            # 创建Topic
            topic_qos = fastdds.TopicQos()
            self.participant.get_default_topic_qos(topic_qos)
            topic = self.participant.create_topic(
                self.topic_name,
                topic_data_type.get_name(),
                topic_qos
            )
            
            # 创建Subscriber
            subscriber_qos = fastdds.SubscriberQos()
            self.participant.get_default_subscriber_qos(subscriber_qos)
            self.subscriber = self.participant.create_subscriber(subscriber_qos)
            
            # 创建Listener
            self.listener = DDSReaderListener(
                data_callback=self.data_callback,
                structure_type=self.structure_type,
                data_class_name=self.data_class_name,
                dds_module=self.dds_module,
                name=self.name
            )
            
            # 创建DataReader
            reader_qos = fastdds.DataReaderQos()
            self.subscriber.get_default_datareader_qos(reader_qos)
            self.reader = self.subscriber.create_datareader(
                topic,
                reader_qos,
                self.listener
            )
            
            logger.info(f"✅ DDS组件初始化成功 [{self.source_id}]")
            
        except Exception as e:
            logger.error(f"❌ DDS组件初始化失败 [{self.source_id}]: {e}")
            raise
    
    def delete(self):
        """清理DDS资源"""
        try:
            if self.participant:
                factory = fastdds.DomainParticipantFactory.get_instance()
                self.participant.delete_contained_entities()
                factory.delete_participant(self.participant)
            logger.info(f"✅ DDS接收器资源已清理 [{self.source_id}]")
        except Exception as e:
            logger.error(f"❌ 清理DDS资源失败 [{self.source_id}]: {e}")
    
    @staticmethod
    def is_available() -> bool:
        """检查DDS是否可用"""
        return DDS_AVAILABLE


class DDSReaderListener(fastdds.DataReaderListener if DDS_AVAILABLE else object):
    """DDS数据读取监听器"""
    
    def __init__(
        self,
        data_callback: Optional[Callable] = None,
        structure_type: str = 'fusion_track',
        data_class_name: str = 'TrackDataClass',
        dds_module = None,
        name:str = 'UnKnowen'
    ):
        """
        初始化监听器
        
        Args:
            data_callback: 数据回调函数，接收解析后的字典
            structure_type: 结构类型（fusion_track, radar_track等）
            data_class_name: DDS数据类名（动态配置）
            dds_module: 动态加载的DDS模块
        """
        if DDS_AVAILABLE:
            super().__init__()
        self.num = 0
        self.data_callback = data_callback
        self.structure_type = structure_type
        self.data_class_name = data_class_name
        self.dds_module = dds_module
        self.name = name
    
    def on_subscription_matched(self, datareader, info):
        """订阅匹配回调"""
        if not DDS_AVAILABLE:
            return
        
        if 0 < info.current_count_change:
            logger.info(f"✅ DDS订阅者匹配发布者: {info.last_publication_handle}")
        else:
            logger.info(f"🔌 DDS订阅者断开发布者: {info.last_publication_handle}")
            self.num = 0
    
    def on_data_available(self, reader):
        """数据可用回调"""
        if not DDS_AVAILABLE:
            return
        
        try:
            info = fastdds.SampleInfo()
            
            # 动态获取数据类
            data_class = getattr(self.dds_module, self.data_class_name)
            data = data_class()
            reader.take_next_sample(data, info)
            self.num += 1
            
            # 使用统一的解析器根据结构类型解析
            if self.data_callback:
                try:
                    parsed_data = self._parse_dds_data(data)
                    parsed_data['name']=self.name
                    print("on_data_available:",parsed_data)
                    if parsed_data:
                        self.data_callback(parsed_data)
                except Exception as e:
                    logger.error(f"❌ DDS数据回调执行失败: {e}")
        
        except Exception as e:
            logger.error(f"❌ DDS数据接收失败: {e}")
    
    def _parse_dds_data(self, data) -> Optional[Dict]:
        """
        解析DDS数据为字典
        使用parsers模块根据structure_type调用不同的解析函数
        """
        try:
            from parsers.dds_parser import parse_dds_data
            return parse_dds_data(data, self.structure_type)
        except Exception as e:
            logger.error(f"❌ 解析DDS数据失败 [{self.structure_type}]: {e}")
            return None
