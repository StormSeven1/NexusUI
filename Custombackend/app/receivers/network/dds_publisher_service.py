"""
DDS数据发布器服务

支持动态加载不同的IDL模块和数据类型
"""
import os
import sys
import ctypes
from threading import Condition
from typing import Optional, Dict, Any
from loguru import logger

# 导入DDS相关模块
try:
    import fastdds
    DDS_AVAILABLE = True
    logger.success("✅ FastDDS 库加载成功！")
except ImportError as e:
    logger.error(f"❌ FastDDS库导入失败: {e}")
    DDS_AVAILABLE = False
except Exception as e:
    logger.error(f"❌ 未知错误: {e}")
    DDS_AVAILABLE = False

from app.dds.xml_config_generator import DDSXMLConfigGenerator


class DDSWriterListener(fastdds.DataWriterListener if DDS_AVAILABLE else object):
    """DDS数据写入监听器"""
    
    def __init__(self, publisher_service):
        """
        初始化监听器
        
        Args:
            publisher_service: DDSPublisherService实例
        """
        self._publisher = publisher_service
        if DDS_AVAILABLE:
            super().__init__()
    
    def on_publication_matched(self, datawriter, info):
        """发布匹配回调"""
        if not DDS_AVAILABLE:
            return
            
        if 0 < info.current_count_change:
            logger.info(f"✅ DDS发布者匹配到订阅者 {info.last_subscription_handle}")
            self._publisher._cvDiscovery.acquire()
            self._publisher._matched_reader += 1
            self._publisher._cvDiscovery.notify()
            self._publisher._cvDiscovery.release()
        else:
            logger.info(f"❌ DDS发布者断开订阅者 {info.last_subscription_handle}")
            self._publisher._cvDiscovery.acquire()
            self._publisher._matched_reader -= 1
            self._publisher._cvDiscovery.notify()
            self._publisher._cvDiscovery.release()


class DDSPublisherService:
    """DDS数据发布器服务（支持动态加载不同IDL模块）"""
    
    def __init__(self, dds_config: Dict):
        """
        初始化DDS发布器
        
        Args:
            dds_config: DDS配置字典，包含：
                - domain_id: DDS域ID
                - topic_name: 主题名称
                - profile_name: 配置文件名称
                - discovery_server_ip: 发现服务器IP
                - discovery_server_port: 发现服务器端口
                - multicast_ip: 组播IP
                - multicast_port: 组播端口
                - dds_module_path: DDS模块路径（包含Python绑定和DLL）
                - structure_type: 数据结构类型（用于数据转换）
        """
        if not DDS_AVAILABLE:
            raise ImportError("FastDDS库未安装，无法创建DDS发布器")
        
        self.dds_config = dds_config
        self.domain_id = dds_config.get('domain_id', 142)
        self.topic_name = dds_config.get('topic_name', 'default_topic')
        self.profile_name = dds_config.get('profile_name', 'default_publisher')
        self.dds_module_path = dds_config.get('dds_module_path')
        self.structure_type = dds_config.get('structure_type', 'unknown')
        
        # DDS数据类名（支持动态配置，其他类名自动推导）
        self.data_class_name = dds_config.get('data_class_name', 'TrackDataClass')
        # 自动推导PubSubType类名和类型名
        self.pubsub_type_class_name = dds_config.get('pubsub_type_class_name', f'{self.data_class_name}PubSubType')
        self.type_name = dds_config.get('type_name', self.data_class_name)
        
        self._matched_reader = 0
        self._cvDiscovery = Condition()
        
        # 动态加载DDS模块
        self.dds_module = None  # 动态加载的模块
        self.dds_data_class = None
        self.dds_pubsub_type = None
        self._load_dds_module()  # 加载模块
        
        # 生成XML配置文件
        self.xml_config_path = self._generate_xml_config()
        
        # 初始化DDS组件
        self.participant = None
        self.publisher = None
        self.topic = None
        self.writer = None
        self.listener = None
        self._init_dds()
        
        logger.info(
            f"✅ DDS发布器初始化成功 | "
            f"域ID: {self.domain_id} | 主题: {self.topic_name} | "
            f"结构类型: {self.structure_type}"
        )
    
    def _load_dds_module(self):
        """根据dds_module_path动态加载DDS模块"""
        if not DDS_AVAILABLE:
            raise ImportError("FastDDS库未安装")
        
        # 动态加载DDS模块
        if not self.dds_module_path or not os.path.exists(self.dds_module_path):
            raise ImportError(f"DDS模块路径不存在: {self.dds_module_path}")
        
        # 添加模块路径到sys.path
        if self.dds_module_path not in sys.path:
            sys.path.insert(0, self.dds_module_path)
        
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
        
        # 查找Python模块文件
        py_files = [f[:-3] for f in os.listdir(self.dds_module_path) 
                   if f.endswith('.py') and not f.startswith('_')]
        
        if not py_files:
            raise ImportError(f"在 {self.dds_module_path} 中未找到Python模块文件")
        
        # 优先使用与data_class_name同名的模块文件
        if self.data_class_name in py_files:
            module_name = self.data_class_name
        else:
            module_name = py_files[0]  # 否则使用第一个找到的.py文件
        
        try:
            import importlib
            self.dds_module = importlib.import_module(module_name)
            logger.success(f"✅ 成功导入DDS模块: {module_name} (可用模块: {py_files})")
        except Exception as e:
            raise ImportError(f"导入DDS模块失败 [{module_name}]: {e}")
        
        # 验证数据类是否存在
        if not hasattr(self.dds_module, self.data_class_name):
            raise ImportError(
                f"{module_name}模块中未找到 {self.data_class_name} 类。"
                f"请在dds_config中配置正确的data_class_name"
            )
        
        if not hasattr(self.dds_module, self.pubsub_type_class_name):
            raise ImportError(
                f"{module_name}模块中未找到 {self.pubsub_type_class_name} 类。"
                f"请在dds_config中配置正确的pubsub_type_class_name"
            )
        
        logger.info(f"✅ DDS模块验证成功: {self.data_class_name}, {self.pubsub_type_class_name}")
    
    def _generate_xml_config(self) -> str:
        """生成XML配置文件，保存到dds_module_path指定的路径下"""
        # 使用配置文件中指定的dds_module_path作为XML配置文件的保存路径
        xml_dir = self.dds_module_path
        os.makedirs(xml_dir, exist_ok=True)
        
        safe_topic_name = self.topic_name.replace('/', '_').replace('\\', '_')
        xml_config_path = os.path.join(
            xml_dir,
            f"dds_publisher_{safe_topic_name}_{self.domain_id}_{self.profile_name}.xml"
        )
        
        DDSXMLConfigGenerator.generate_publisher_xml(
            profile_name=self.profile_name,
            discovery_server_ip=self.dds_config.get('discovery_server_ip', '192.168.18.141'),
            discovery_server_port=self.dds_config.get('discovery_server_port', 11611),
            multicast_ip=self.dds_config.get('multicast_ip', '239.255.0.1'),
            multicast_port=self.dds_config.get('multicast_port', 12359),
            output_path=xml_config_path
        )
        
        return xml_config_path
    
    def _init_dds(self):
        """初始化DDS组件"""
        factory = fastdds.DomainParticipantFactory.get_instance()
        participant_qos = fastdds.DomainParticipantQos()
        factory.get_default_participant_qos(participant_qos)
        
        # 验证XML配置文件是否存在
        if not os.path.exists(self.xml_config_path):
            raise RuntimeError(f"XML配置文件不存在: {self.xml_config_path}")
        
        # 加载XML配置文件
        try:
            factory.load_XML_profiles_file(self.xml_config_path)
            logger.debug(f"✅ 加载XML配置文件: {self.xml_config_path}")
        except Exception as e:
            raise RuntimeError(f"加载XML配置文件失败: {e}")
        
        # 创建参与者
        self.participant = factory.create_participant_with_profile(
            self.domain_id,
            self.profile_name
        )
        
        if self.participant is None:
            raise RuntimeError(
                f"DDS参与者初始化失败 | "
                f"域ID: {self.domain_id} | "
                f"配置名: {self.profile_name} | "
                f"XML: {self.xml_config_path} | "
                f"可能原因: profile_name在XML中不存在，或domain_id冲突"
            )
        
        # 动态注册数据类型
        pubsub_type_class = getattr(self.dds_module, self.pubsub_type_class_name)
        topic_data_type = pubsub_type_class()
        topic_data_type.set_name(self.type_name)
        type_support = fastdds.TypeSupport(topic_data_type)
        
        try:
            self.participant.register_type(type_support)
        except Exception:
            pass
        
        # 创建主题
        topic_qos = fastdds.TopicQos()
        self.participant.get_default_topic_qos(topic_qos)
        self.topic = self.participant.create_topic(
            self.topic_name,
            self.type_name,
            topic_qos
        )
        
        # 创建发布者
        publisher_qos = fastdds.PublisherQos()
        self.participant.get_default_publisher_qos(publisher_qos)
        self.publisher = self.participant.create_publisher(publisher_qos)
        
        # 创建监听器
        self.listener = DDSWriterListener(self)
        
        # 创建数据写入器
        writer_qos = fastdds.DataWriterQos()
        self.publisher.get_default_datawriter_qos(writer_qos)
        self.writer = self.publisher.create_datawriter(
            self.topic,
            writer_qos,
            self.listener
        )
        
        logger.info("✅ DDS发布器组件初始化成功")
    
    def write(self, track_data: Dict):
        """
        发布数据
        
        Args:
            track_data: 航迹数据字典
        """
        if not DDS_AVAILABLE or not self.writer:
            return
        
        try:
            import time
            t_start = time.time()
            
            # 动态创建DDS数据对象
            t1 = time.time()
            data_class = getattr(self.dds_module, self.data_class_name)
            data = data_class()
            create_time = (time.time() - t1) * 1000
            
            # 填充数据
            t2 = time.time()
            self._fill_data(data, track_data)
            fill_time = (time.time() - t2) * 1000
            
            # 发布数据
            t3 = time.time()
            self.writer.write(data)
            write_time = (time.time() - t3) * 1000
            
            total_time = (time.time() - t_start) * 1000
            
            # 只在耗时超过10ms时输出告警
            # if total_time > 30:
                # print(f"⚠️ [DDS慢] topic={self.topic_name} domain={self.domain_id} | 总={total_time:.2f}ms 创建={create_time:.2f}ms 填充={fill_time:.2f}ms 写入={write_time:.2f}ms")
            
            logger.debug(f"📤 DDS发布数据: {self.topic_name}")
            
        except Exception as e:
            logger.error(f"❌ DDS发布数据失败: {e}")
    
    def _fill_data(self, data, track_data: Dict):
        """
        填充数据到DDS对象
        
        Args:
            data: DDS数据对象
            track_data: 航迹数据字典
        """
        # 遍历所有字段，如果数据中存在则设置
        for key, value in track_data.items():
            if value is None:
                continue
            
            try:
                # 检查对象是否有该属性的setter方法
                if hasattr(data, key):
                    setter = getattr(data, key)
                    if callable(setter):
                        # 处理特殊类型
                        if isinstance(value, dict):
                            # 嵌套对象，递归处理
                            nested_obj = setter()
                            if hasattr(nested_obj, '__class__'):
                                self._fill_data(nested_obj, value)
                        elif isinstance(value, list):
                            # 列表类型
                            setter(value)
                        else:
                            # 基本类型
                            setter(value)
            except Exception as e:
                logger.debug(f"设置字段 {key} 失败: {e}")
    
    def wait_discovery(self, timeout: Optional[float] = None):
        """
        等待发现订阅者
        
        Args:
            timeout: 超时时间（秒）
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
    
    def delete(self):
        """清理DDS资源"""
        if not DDS_AVAILABLE:
            return
        
        try:
            if self.participant:
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
