"""
MQTT接收器 - 订阅MQTT主题接收数据
"""
import json
from typing import Callable, Optional, Dict, Any, List
from loguru import logger

try:
    import paho.mqtt.client as mqtt
    MQTT_AVAILABLE = True
except ImportError:
    MQTT_AVAILABLE = False
    logger.warning("paho-mqtt未安装，MQTT功能不可用")


class MQTTReceiver:
    """MQTT接收器"""
    
    def __init__(self, config: Dict[str, Any], callback: Callable[[bytes, str, str], None]):
        """
        Args:
            config: MQTT配置
            callback: 数据回调函数 callback(data, topic, receiver_id)
        """
        self.broker = config.get('broker', 'localhost')
        self.port = config.get('port', 1883)
        self.client_id = config.get('client_id', 'mqtt_receiver')
        self.username = config.get('username')
        self.password = config.get('password')
        self.topics: List[Dict] = config.get('topics', [])
        
        self.callback = callback
        self.client: Optional[mqtt.Client] = None
        self.running = False
    
    def start(self):
        """启动MQTT接收器"""
        if not MQTT_AVAILABLE:
            logger.error("MQTT功能不可用，请安装paho-mqtt")
            return
        
        if self.running:
            return
        
        try:
            self.client = mqtt.Client(client_id=self.client_id)
            
            if self.username:
                self.client.username_pw_set(self.username, self.password)
            
            self.client.on_connect = self._on_connect
            self.client.on_message = self._on_message
            self.client.on_disconnect = self._on_disconnect
            
            self.client.connect(self.broker, self.port, keepalive=60)
            self.running = True
            self.client.loop_start()
            
            logger.info(f"MQTT接收器已启动: {self.broker}:{self.port}")
        except Exception as e:
            logger.error(f"MQTT接收器启动失败: {e}")
    
    def stop(self):
        """停止MQTT接收器"""
        self.running = False
        if self.client:
            try:
                self.client.loop_stop()
                self.client.disconnect()
            except:
                pass
            self.client = None
        logger.info("MQTT接收器已停止")
    
    def _on_connect(self, client, userdata, flags, rc):
        """连接回调"""
        if rc == 0:
            logger.info(f"MQTT连接成功: {self.broker}:{self.port}")
            for topic_config in self.topics:
                topic = topic_config.get('topic')
                if topic:
                    client.subscribe(topic)
                    logger.info(f"MQTT订阅主题: {topic}")
        else:
            logger.error(f"MQTT连接失败, rc={rc}")
    
    def _on_message(self, client, userdata, msg):
        """消息回调"""
        try:
            if self.callback:
                self.callback(msg.payload, msg.topic, 'mqtt')
        except Exception as e:
            logger.error(f"处理MQTT消息出错: {e}")
    
    def _on_disconnect(self, client, userdata, rc):
        """断开连接回调"""
        if rc != 0 and self.running:
            logger.warning(f"MQTT意外断开连接, rc={rc}")
