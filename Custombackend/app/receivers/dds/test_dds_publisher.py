#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DDS发布器测试示例
测试从配置文件动态创建DDS发布器并发送数据

使用方法：
  从 backend 目录运行：
    python -m app.dds.test_dds_publisher
    python -m app.dds.test_dds_publisher simple
  
  或者从 app/dds 目录运行（使用相对导入）：
    python test_dds_publisher.py
    python test_dds_publisher.py simple
"""
import sys
import os
import time
from pathlib import Path
from loguru import logger

# 配置日志
logger.remove()
logger.add(sys.stderr, level="INFO")

# 添加项目根目录到Python路径
# 如果从 app/dds 目录运行，需要添加 backend 目录到路径
current_dir = Path(__file__).parent
backend_dir = current_dir.parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

try:
    from app.dds.dds_publisher import DDSPublisher
except ImportError as e:
    logger.error(f"导入DDS模块失败: {e}")
    logger.error("请确保已安装FastDDS库并正确配置环境")
    logger.error(f"当前Python路径: {sys.path}")
    logger.error(f"当前工作目录: {os.getcwd()}")
    logger.error(f"脚本所在目录: {current_dir}")
    logger.error(f"Backend目录: {backend_dir}")
    sys.exit(1)


def test_dds_publisher_with_config():
    """测试使用配置参数创建DDS发布器"""
    logger.info("=" * 80)
    logger.info("测试DDS发布器（使用配置参数）")
    logger.info("=" * 80)
    
    # 检查DDS是否可用
    if not DDSPublisher.is_available():
        logger.error("❌ FastDDS库未安装，无法运行测试")
        return
    
    try:
        # 创建DDS发布器（使用配置参数）
        logger.info("创建DDS发布器...")
        publisher = DDSPublisher(
            domain_id=142,
            topic_name="TrackDataClassTopic_FuseTrack",
            profile_name="track_subscriber_client",
            discovery_server_ip="192.168.18.141",
            discovery_server_port=11611,
            multicast_ip="239.255.0.1",
            multicast_port=12359
        )
        
        logger.info("✅ DDS发布器创建成功")
        logger.info("⏳ 等待发现订阅者...")
        
        # 等待发现订阅者（超时10秒）
        publisher.wait_discovery(timeout=10.0)
        
        logger.info("🚀 开始发送测试数据，按Ctrl+C停止...")
        logger.info("=" * 80)
        
        # 发送测试数据
        track_id = 1000
        try:
            while True:
                # 构造测试数据
                test_data = {
                    'trackId': track_id,
                    'uniqueId': track_id + 10000,
                    'longitude': 116.391 + (track_id % 100) * 0.01,
                    'latitude': 39.907 + (track_id % 100) * 0.01,
                    'course': 45.0,
                    'distance': 1000.0,
                    'speed': 10.0,
                    'speed_N': 7.07,
                    'speed__E': 7.07,
                    'speed_V': 0.0,
                    'height': 50.0,
                    'azimuth': 30.0,
                    'range': 5000.0,
                    'sizeMetres': 20.0,
                    'sizeDegrees': 0.01,
                    'radarId': 'RADAR001',
                    'dotID': track_id * 10,
                    'trackQuality': 90,
                    'fusion': 1,
                    'sensors': 0b00000011,
                    'trackID': [track_id + i for i in range(8)],
                    'timeStamp': int(time.time()),
                    'threatScore': 30.5,
                    'threatLevel': 1,
                    'trackCategoryId': 1,
                    'trackCategoryName': 'Commercial Vessel',
                    'trackAlias': f'Ship-{track_id}',
                    'mmsi': 123456789,
                    'isManual': False,
                    'modifiedBy': 'system',
                    'modifiedTime': int(time.time())
                }
                
                # 发送数据
                publisher.write(test_data)
                logger.info(f"📤 已发送航迹数据: trackId={track_id}")
                
                track_id += 1
                time.sleep(1)  # 每秒发送一次
                
        except KeyboardInterrupt:
            logger.info("\n⚠️ 接收到停止信号")
        
    except Exception as e:
        logger.error(f"❌ 测试失败: {e}", exc_info=True)
    finally:
        # 清理资源
        try:
            publisher.delete()
            logger.info("✅ DDS发布器资源已清理")
        except:
            pass


def test_dds_publisher_simple():
    """测试使用默认配置创建DDS发布器"""
    logger.info("=" * 80)
    logger.info("测试DDS发布器（使用默认配置，发送简单数据）")
    logger.info("=" * 80)
    
    # 检查DDS是否可用
    if not DDSPublisher.is_available():
        logger.error("❌ FastDDS库未安装，无法运行测试")
        return
    
    try:
        # 使用默认配置创建发布器
        logger.info("创建DDS发布器（默认配置）...")
        publisher = DDSPublisher()
        
        logger.info("✅ DDS发布器创建成功")
        logger.info("⏳ 等待发现订阅者...")
        
        # 等待发现订阅者
        publisher.wait_discovery(timeout=10.0)
        
        logger.info("🚀 开始发送测试数据（仅trackId），按Ctrl+C停止...")
        logger.info("=" * 80)
        
        # 发送简单测试数据（只设置trackId）
        try:
            while True:
                publisher.write()  # 使用默认数据
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("\n⚠️ 接收到停止信号")
        
    except Exception as e:
        logger.error(f"❌ 测试失败: {e}", exc_info=True)
    finally:
        try:
            publisher.delete()
            logger.info("✅ DDS发布器资源已清理")
        except:
            pass


if __name__ == '__main__':
    logger.info("DDS发布器测试程序")
    logger.info("=" * 80)
    
    # 选择测试模式
    if len(sys.argv) > 1 and sys.argv[1] == 'simple':
        test_dds_publisher_simple()
    else:
        test_dds_publisher_with_config()
    
    logger.info("=" * 80)
    logger.info("测试完成")
