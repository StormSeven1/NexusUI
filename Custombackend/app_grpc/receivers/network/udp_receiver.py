"""
UDP接收器 - 支持单播、组播、广播
"""
import socket
import struct
import threading
from typing import Callable, Optional, Dict, Any
from loguru import logger


class UDPReceiver:
    """UDP接收器"""
    
    def __init__(self, config: Dict[str, Any], callback: Callable[[bytes, tuple, str], None]):
        """
        Args:
            config: 接收器配置
            callback: 数据回调函数 callback(data, addr, receiver_id)
        """
        self.id = config.get('id', 'unknown')
        self.name = config.get('name', '')
        self.type = config.get('type', 'unicast')  # unicast/multicast/broadcast
        self.host = config.get('host', '0.0.0.0')
        self.port = config.get('port', 0)
        self.data_format = config.get('data_format', 'FusionTrack')
        self.local_interface = config.get('local_interface', '0.0.0.0')
        self.buffer_size = config.get('buffer_size', 65536)
        
        self.callback = callback
        self.socket: Optional[socket.socket] = None
        self.running = False
        self.thread: Optional[threading.Thread] = None
    
    def start(self):
        """启动接收器"""
        if self.running:
            return
        
        self.running = True
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        logger.info(f"UDP接收器已启动: [{self.id}] {self.name} - {self.type} {self.host}:{self.port}")
    
    def stop(self):
        """停止接收器"""
        self.running = False
        if self.socket:
            try:
                self.socket.close()
            except:
                pass
            self.socket = None
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2)
        logger.info(f"UDP接收器已停止: [{self.id}] {self.name}")
    
    def _create_socket(self) -> socket.socket:
        """创建socket"""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return sock
    
    def _run(self):
        """运行接收循环"""
        try:
            self.socket = self._create_socket()
            
            if self.type == 'multicast':
                self._setup_multicast()
            elif self.type == 'broadcast':
                self._setup_broadcast()
            else:
                self._setup_unicast()
            
            self.socket.settimeout(1.0)
            
            while self.running:
                try:
                    data, addr = self.socket.recvfrom(self.buffer_size)
                    if data and self.callback:
                        try:
                            self.callback(data, addr, self.id)
                        except Exception as e:
                            logger.error(f"处理UDP数据出错 [{self.id}]: {e}")
                except socket.timeout:
                    continue
                except Exception as e:
                    if self.running:
                        logger.error(f"接收UDP数据出错 [{self.id}]: {e}")
                    break
        except Exception as e:
            logger.error(f"UDP接收器运行失败 [{self.id}]: {e}")
        finally:
            if self.socket:
                try:
                    self.socket.close()
                except:
                    pass
                self.socket = None
    
    def _setup_unicast(self):
        """设置单播"""
        self.socket.bind((self.host, self.port))
        logger.info(f"UDP单播接收器绑定: {self.host}:{self.port}")
    
    def _setup_multicast(self):
        """设置组播"""
        self.socket.bind(("", self.port))
        mreq = struct.pack(
            "4s4s",
            socket.inet_aton(self.host),
            socket.inet_aton(self.local_interface)
        )
        self.socket.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
        logger.info(f"UDP组播接收器加入: {self.host}:{self.port}, 本机IP: {self.local_interface}")
    
    def _setup_broadcast(self):
        """设置广播"""
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        self.socket.bind(("", self.port))
        logger.info(f"UDP广播接收器绑定: 0.0.0.0:{self.port}")
