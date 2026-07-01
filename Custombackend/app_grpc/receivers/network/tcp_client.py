"""
TCP客户端 - 连接远程服务器接收数据
"""
import socket
import threading
import time
from typing import Callable, Optional, Dict, Any
from loguru import logger


class TCPClient:
    """TCP客户端接收器"""
    
    def __init__(self, config: Dict[str, Any], callback: Callable[[bytes, str], None]):
        """
        Args:
            config: 客户端配置
            callback: 数据回调函数 callback(data, client_id)
        """
        self.id = config.get('id', 'unknown')
        self.name = config.get('name', '')
        self.host = config.get('host', '127.0.0.1')
        self.port = config.get('port', 0)
        self.data_format = config.get('data_format', 'FusionTrack')
        self.reconnect_interval = config.get('reconnect_interval', 5)
        self.buffer_size = config.get('buffer_size', 65536)
        
        self.callback = callback
        self.socket: Optional[socket.socket] = None
        self.running = False
        self.thread: Optional[threading.Thread] = None
    
    def start(self):
        """启动客户端"""
        if self.running:
            return
        
        self.running = True
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        logger.info(f"TCP客户端已启动: [{self.id}] {self.name} -> {self.host}:{self.port}")
    
    def stop(self):
        """停止客户端"""
        self.running = False
        if self.socket:
            try:
                self.socket.close()
            except:
                pass
            self.socket = None
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2)
        logger.info(f"TCP客户端已停止: [{self.id}] {self.name}")
    
    def _run(self):
        """运行接收循环"""
        while self.running:
            try:
                self._connect_and_receive()
            except Exception as e:
                if self.running:
                    logger.warning(f"TCP连接断开 [{self.id}]: {e}, {self.reconnect_interval}秒后重连")
                    time.sleep(self.reconnect_interval)
    
    def _connect_and_receive(self):
        """连接并接收数据"""
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.socket.settimeout(10)
        
        try:
            self.socket.connect((self.host, self.port))
            logger.info(f"TCP连接成功 [{self.id}]: {self.host}:{self.port}")
            self.socket.settimeout(1.0)
            
            while self.running:
                try:
                    data = self.socket.recv(self.buffer_size)
                    if not data:
                        raise ConnectionError("连接已关闭")
                    if self.callback:
                        try:
                            self.callback(data, self.id)
                        except Exception as e:
                            logger.error(f"处理TCP数据出错 [{self.id}]: {e}")
                except socket.timeout:
                    continue
        finally:
            if self.socket:
                try:
                    self.socket.close()
                except:
                    pass
                self.socket = None
