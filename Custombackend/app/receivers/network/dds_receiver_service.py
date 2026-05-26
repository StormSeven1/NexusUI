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
        self.dds_config = source_config.get('dds_config', {})
        self.data_callback = data_callback
        self.name = source_config['name']
        
        # DDS配置参数
        self.domain_id = self.dds_config.get('domain_id', 142)
        self.topic_name = self.dds_config.get('topic_name', 'TrackDataClassTopic_FuseTrack')
        self.profile_name = self.dds_config.get('profile_name', 'track_subscriber_client')
        self.discovery_server_ip = self.dds_config.get('discovery_server_ip', '192.168.18.141')
        self.discovery_server_port = self.dds_config.get('discovery_server_port', 11611)
        self.multicast_ip = self.dds_config.get('multicast_ip', '239.255.0.1')
        self.multicast_port = self.dds_config.get('multicast_port', 12359)
        
        # DDS模块路径和结构类型
        self.dds_module_path = self.dds_config.get('dds_module_path', '')
        self.structure_type = self.dds_config.get('structure_type', 'fusion_track')
        
        # DDS数据类名（支持动态配置，其他类名自动推导）
        self.data_class_name = self.dds_config.get('data_class_name', 'TrackDataClass')
        self.dds_module_name = (self.dds_config.get('dds_module_name') or '').strip()
        # 自动推导PubSubType类名和类型名
        self.pubsub_type_class_name = self.dds_config.get('pubsub_type_class_name', f'{self.data_class_name}PubSubType')
        self.type_name = self.dds_config.get('type_name', self.data_class_name)
        
        # 动态加载的DDS模块和对象
        self.dds_module = None  # 动态加载的模块
        self.dds_data_class = None
        self.pubsub_type_class = None
        self.binding_module = None
        
        # 是否使用默认XML（不生成自定义XML，直接用domain_id创建participant）
        self.use_default_xml = self.dds_config.get('use_default_xml', False)
        # 使用模块目录下的静态 XML（与 entity_subscriber.xml 等统一维护），设置后不再动态生成 subscriber XML
        self.subscriber_xml_file = (self.dds_config.get('subscriber_xml_file') or '').strip()
        # 若与 data_class_name 不同名（例如 data_class=CameraRealTimeStatus 但绑定在 EntityRealTimeStatus 包），指定 Python 模块名
        self.dds_python_module = (self.dds_config.get('dds_python_module') or '').strip()
        
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
        
        # 生成XML配置（仅在非默认XML模式下）
        if not self.use_default_xml:
            self._generate_xml_config()
        else:
            logger.info(f"📋 DDS接收器 [{self.source_id}] 使用默认XML模式，跳过XML生成")
        
        # 初始化DDS组件
        self._init_dds()
        
        logger.info(
            f"✅ DDS接收器服务初始化成功 [{self.source_id}] | "
            f"模块: {self.dds_module_path} | 结构类型: {self.structure_type}"
        )
    
    def _list_all_so_preload_order(self) -> list[str]:
        """其它 DDS 模块：保持原行为，目录内全部 .so（先 lib 后 wrapper）。"""
        so_files = [f for f in os.listdir(self.dds_module_path) if f.endswith(".so")]
        lib_files = sorted(f for f in so_files if f.startswith("lib"))
        wrapper_files = sorted(f for f in so_files if not f.startswith("lib"))
        return lib_files + wrapper_files

    def _resolve_dds_so_preload_list(self, python_module_name: str) -> list[str]:
        """按 Python 绑定模块选择 .so，避免 Camera 目录新旧 IDL 混载导致收不到样本。"""
        if python_module_name == "EntityRealTimeStatus":
            return ["libEntityRealTimeStatus.so", "_EntityRealTimeStatusWrapper.so"]
        if python_module_name == "CameraRealTimeStatus":
            return ["libCameraRealTimeStatus.so", "_CameraRealTimeStatusWrapper.so"]
        return self._list_all_so_preload_order()

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
        if self.dds_python_module:
            logger.info(f"  - dds_python_module: {self.dds_python_module}")
        if self.subscriber_xml_file:
            logger.info(f"  - subscriber_xml_file: {self.subscriber_xml_file}")
        
        # 动态加载DDS模块
        if not self.dds_module_path or not os.path.exists(self.dds_module_path):
            raise ImportError(f"DDS模块路径不存在: {self.dds_module_path}")
        
        # 添加模块路径到sys.path
        if self.dds_module_path not in sys.path:
            sys.path.insert(0, self.dds_module_path)
            logger.info(f"✅ 添加模块路径到sys.path: {self.dds_module_path}")
        
        # 查找Python模块文件（通常是TrackRealTimeStatus.py或类似名称）
        py_files = [f[:-3] for f in os.listdir(self.dds_module_path)
                   if f.endswith('.py') and not f.startswith('_')]

        if not py_files:
            raise ImportError(f"在 {self.dds_module_path} 中未找到Python模块文件")

        # 优先 dds_module_name / dds_python_module；否则与 data_class_name 同名的 .py；再否则第一个 .py
        if self.dds_module_name and self.dds_module_name in py_files:
            module_name = self.dds_module_name
        elif self.dds_python_module:
            module_name = self.dds_python_module
        elif self.data_class_name in py_files:
            module_name = self.data_class_name
        else:
            module_name = py_files[0]
            if len(py_files) > 1:
                logger.warning(
                    f"⚠️ [{self.source_id}] 未匹配 data_class_name={self.data_class_name!r}，"
                    f"回退模块 {module_name!r}，建议配置 dds_module_name"
                )

        # 预加载 .so：Camera 目录同时含新旧两套绑定，全量 RTLD_GLOBAL 会符号冲突 → 匹配发布者但收不到样本
        so_preload = self._resolve_dds_so_preload_list(module_name)
        for so_filename in so_preload:
            so_file = os.path.join(self.dds_module_path, so_filename)
            if not os.path.isfile(so_file):
                logger.debug(f"⚠️ 跳过不存在的共享库: {so_file}")
                continue
            try:
                ctypes.CDLL(so_file, mode=ctypes.RTLD_GLOBAL)
                logger.info(f"✅ 预加载共享库: {so_file}")
            except Exception as e:
                logger.debug(f"⚠️ 预加载共享库失败 [{so_filename}]: {e}")

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

            if self.subscriber_xml_file:
                self.xml_config_path = os.path.join(xml_dir, self.subscriber_xml_file)
                if not os.path.isfile(self.xml_config_path):
                    raise FileNotFoundError(
                        f"subscriber_xml_file 未找到: {self.xml_config_path}"
                    )
                logger.info(f"✅ 使用静态 subscriber XML: {self.xml_config_path}")
                return
            
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
            
            if self.use_default_xml:
                # 默认XML模式：直接用domain_id和默认QoS创建participant
                logger.info(f"📋 使用默认XML创建DDS参与者: domain_id={self.domain_id}")
                self.participant = factory.create_participant(
                    self.domain_id,
                    participant_qos
                )
            else:
                # 自定义XML模式：加载XML配置文件，用profile创建participant
                factory.load_XML_profiles_file(self.xml_config_path)
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
            logger.info(f"📊 当前匹配的发布者数量: {info.current_count}")
            logger.info(f"🔍 Listener已注册，等待数据... (structure_type={self.structure_type})")
        else:
            logger.info(f"🔌 DDS订阅者断开发布者: {info.last_publication_handle}")
            logger.info(f"📊 当前匹配的发布者数量: {info.current_count}")
            self.num = 0
    
    def on_data_available(self, reader):
        # print("AAA:","data")
        """数据可用回调"""
        if not DDS_AVAILABLE:
            return
        
        try:
            info = fastdds.SampleInfo()
            data_class = getattr(self.dds_module, self.data_class_name)
            data = data_class()

            while reader.take_next_sample(data, info) == fastdds.RETCODE_OK:
                if not info.valid_data:
                    continue
                self.num += 1
                if not self.data_callback:
                    continue
                try:
                    from parsers.dds_parser import parse_dds_data
                    parsed = parse_dds_data(data, self.structure_type)
                    if not parsed:
                        continue
                    items = parsed if isinstance(parsed, list) else [parsed]
                    for parsed_data in items:
                        if not isinstance(parsed_data, dict):
                            continue
                        parsed_data['name'] = self.name
                        self.data_callback(parsed_data)
                except Exception as e:
                    logger.error(f"❌ DDS数据回调执行失败: {e}", exc_info=True)
        
        except Exception as e:
            logger.error(f"❌ DDS数据接收失败: {e}", exc_info=True)
