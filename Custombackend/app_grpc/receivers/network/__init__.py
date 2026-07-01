"""
数据接收器模块
"""
from .udp_receiver import UDPReceiver
from .tcp_client import TCPClient
from .mqtt_receiver import MQTTReceiver
from .http_poller import HTTPPoller

# DDS模块 - 使用新的动态DDS接收器服务
try:
    from .dds_receiver_service import DDSReceiverService
    DDS_AVAILABLE = True
except ImportError:
    DDSReceiverService = None
    DDS_AVAILABLE = False

__all__ = [
    'UDPReceiver',
    'TCPClient',
    'MQTTReceiver',
    'HTTPPoller',
    'DDSReceiverService',
    'DDS_AVAILABLE',
]
