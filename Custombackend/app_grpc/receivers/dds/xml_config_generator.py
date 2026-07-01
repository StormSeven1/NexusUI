"""
DDS XML配置文件生成器
根据配置参数动态生成DDS的XML配置文件
"""
import os
from typing import Dict, Optional
from loguru import logger


class DDSXMLConfigGenerator:
    """DDS XML配置文件生成器"""
    
    @staticmethod
    def generate_subscriber_xml(
        profile_name: str,
        discovery_server_ip: str,
        discovery_server_port: int,
        multicast_ip: str,
        multicast_port: int,
        output_path: Optional[str] = None
    ) -> str:
        """
        生成订阅者XML配置文件
        
        Args:
            profile_name: 配置文件名称
            discovery_server_ip: 发现服务器IP
            discovery_server_port: 发现服务器端口
            multicast_ip: 组播IP
            multicast_port: 组播端口
            output_path: 输出文件路径（如果为None，则返回XML字符串）
            
        Returns:
            XML配置字符串
        """
        xml_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<dds xmlns="http://www.eprosima.com/XMLSchemas/fastRTPS_Profiles">
    <profiles>
        <participant profile_name="{profile_name}">
            <rtps>
                <builtin>
                    <discovery_config>
                        <discoveryProtocol>CLIENT</discoveryProtocol>
                        <discoveryServersList>
                                    <locator>
                                        <udpv4>
                                            <!-- 发现服务器IP和端口 -->
                                            <address>{discovery_server_ip}</address>
                                            <port>{discovery_server_port}</port>
                                        </udpv4>
                                    </locator>
                        </discoveryServersList>
                    </discovery_config>
                </builtin>
                <defaultMulticastLocatorList>
                    <locator>
                        <udpv4>
                            <!-- 组播的目标IP和端口 -->
                            <address>{multicast_ip}</address>
                            <port>{multicast_port}</port>
                        </udpv4>
                    </locator>
                </defaultMulticastLocatorList>
            </rtps>
        </participant>
    </profiles>
</dds>
"""
        
        if output_path:
            try:
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                with open(output_path, 'w', encoding='utf-8') as f:
                    f.write(xml_content)
                logger.info(f"✅ DDS订阅者XML配置文件已生成: {output_path}")
            except Exception as e:
                logger.error(f"❌ 生成DDS订阅者XML配置文件失败: {e}")
        
        return xml_content
    
    @staticmethod
    def generate_publisher_xml(
        profile_name: str,
        discovery_server_ip: str,
        discovery_server_port: int,
        multicast_ip: str,
        multicast_port: int,
        output_path: Optional[str] = None
    ) -> str:
        """
        生成发布者XML配置文件
        
        Args:
            profile_name: 配置文件名称
            discovery_server_ip: 发现服务器IP
            discovery_server_port: 发现服务器端口
            multicast_ip: 组播IP
            multicast_port: 组播端口
            output_path: 输出文件路径（如果为None，则返回XML字符串）
            
        Returns:
            XML配置字符串
        """
        xml_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<dds xmlns="http://www.eprosima.com/XMLSchemas/fastRTPS_Profiles">
    <profiles>
        <participant profile_name="{profile_name}">
            <rtps>
                <builtin>
                    <discovery_config>
                        <discoveryProtocol>CLIENT</discoveryProtocol>
                        <discoveryServersList>
                                    <locator>
                                        <udpv4>
                                            <!-- 发现服务器IP和端口 -->
                                            <address>{discovery_server_ip}</address>
                                            <port>{discovery_server_port}</port>
                                        </udpv4>
                                    </locator>
                        </discoveryServersList>
                    </discovery_config>
                </builtin>
                <defaultMulticastLocatorList>
                    <locator>
                        <udpv4>
                            <!-- 组播的目标IP和端口 -->
                            <address>{multicast_ip}</address>
                            <port>{multicast_port}</port>
                        </udpv4>
                    </locator>
                </defaultMulticastLocatorList>
            </rtps>
        </participant>
    </profiles>
</dds>
"""
        
        if output_path:
            try:
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                with open(output_path, 'w', encoding='utf-8') as f:
                    f.write(xml_content)
                logger.info(f"✅ DDS发布者XML配置文件已生成: {output_path}")
            except Exception as e:
                logger.error(f"❌ 生成DDS发布者XML配置文件失败: {e}")
        
        return xml_content
    
    @staticmethod
    def generate_config_from_dict(config: Dict, config_type: str = 'subscriber') -> str:
        """
        从配置字典生成XML配置
        
        Args:
            config: 配置字典，包含以下字段：
                - profile_name: 配置文件名称
                - discovery_server_ip: 发现服务器IP
                - discovery_server_port: 发现服务器端口
                - multicast_ip: 组播IP
                - multicast_port: 组播端口
                - output_path: 输出文件路径（可选）
            config_type: 配置类型（'subscriber' 或 'publisher'）
            
        Returns:
            XML配置字符串
        """
        profile_name = config.get('profile_name', 'default_profile')
        discovery_server_ip = config.get('discovery_server_ip', '192.168.18.141')
        discovery_server_port = config.get('discovery_server_port', 11611)
        multicast_ip = config.get('multicast_ip', '239.255.0.1')
        multicast_port = config.get('multicast_port', 12359)
        output_path = config.get('output_path')
        
        if config_type == 'subscriber':
            return DDSXMLConfigGenerator.generate_subscriber_xml(
                profile_name=profile_name,
                discovery_server_ip=discovery_server_ip,
                discovery_server_port=discovery_server_port,
                multicast_ip=multicast_ip,
                multicast_port=multicast_port,
                output_path=output_path
            )
        elif config_type == 'publisher':
            return DDSXMLConfigGenerator.generate_publisher_xml(
                profile_name=profile_name,
                discovery_server_ip=discovery_server_ip,
                discovery_server_port=discovery_server_port,
                multicast_ip=multicast_ip,
                multicast_port=multicast_port,
                output_path=output_path
            )
        else:
            raise ValueError(f"不支持的配置类型: {config_type}")
