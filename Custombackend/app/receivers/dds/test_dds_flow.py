#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DDS数据流转测试
完整流程：订阅对海融合数据 → 转发到新topic → 验证接收

使用方法：
  从 backend 目录运行：
    python -m app.dds.test_dds_flow
  
  或者从 app/dds 目录运行：
    python test_dds_flow.py
"""
import sys
import os
import time
import threading
from pathlib import Path
from loguru import logger

# 配置日志
logger.remove()
logger.add(sys.stderr, level="INFO", format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan> - <level>{message}</level>")

# 添加项目根目录到Python路径
current_dir = Path(__file__).parent
backend_dir = current_dir.parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

try:
    from app.dds.dds_receiver import DDSReceiver
    from app.dds.dds_publisher import DDSPublisher
except ImportError as e:
    logger.error(f"导入DDS模块失败: {e}")
    logger.error("请确保已安装FastDDS库并正确配置环境")
    sys.exit(1)


class DDSDataFlow:
    """DDS数据流转测试类"""
    
    def __init__(self):
        self.source_receiver = None  # 订阅对海融合数据
        self.relay_publisher = None  # 转发到新topic
        self.target_receiver = None  # 订阅新topic
        self.received_count = 0
        self.forwarded_count = 0
        self.final_received_count = 0
        self.running = False
        
    def on_source_data_received(self, data: dict):
        """接收到对海融合数据的回调（简化版，不解析详细数据）"""
        self.received_count += 1
        logger.info(f"📥 [步骤1] 接收到对海融合数据 #{self.received_count}")
        
        # 立即转发到新topic（发送简单的测试数据）
        if self.relay_publisher:
            try:
                # 构造简单的测试数据
                test_data = {
                    'trackId': 8000 + self.received_count,
                    'uniqueId': 18000 + self.received_count,
                    'longitude': 120.0 + self.received_count * 0.001,
                    'latitude': 30.0 + self.received_count * 0.001,
                    'speed': 10.0,
                    'course': 45.0,
                    'height': 100.0
                }
                
                # 使用 write 方法发布数据
                self.relay_publisher.write(test_data)
                self.forwarded_count += 1
                logger.success(f"📤 [步骤2] 已转发测试数据到新topic #{self.forwarded_count}")
                logger.info(f"    转发数据: trackId={test_data['trackId']}, uniqueId={test_data['uniqueId']}")
                logger.info(f"    位置: ({test_data['longitude']:.6f}, {test_data['latitude']:.6f})")
            except Exception as e:
                logger.error(f"❌ [步骤2] 转发异常: {e}")
        
        logger.info("-" * 80)
    
    def on_target_data_received(self, data: dict):
        """接收到新topic数据的回调（简化版）"""
        self.final_received_count += 1
        logger.success(f"✅ [步骤3] 从新topic接收到数据 #{self.final_received_count}")
        # 打印接收到的数据
        if data:
            logger.info(f"    接收数据: trackId={data.get('trackId')}, uniqueId={data.get('uniqueId')}")
            logger.info(f"    位置: ({data.get('longitude', 0):.6f}, {data.get('latitude', 0):.6f})")
            logger.info(f"    速度: {data.get('speed', 0):.2f}, 航向: {data.get('course', 0):.2f}°")
        logger.info("=" * 80)
    
    def start(self):
        """启动完整的数据流转测试"""
        logger.info("=" * 80)
        logger.info("🚀 DDS数据流转测试")
        logger.info("流程: 对海融合数据 → 订阅 → 转发 → 新topic → 订阅")
        logger.info("=" * 80)
        
        # 检查DDS是否可用
        if not DDSReceiver.is_available() or not DDSPublisher.is_available():
            logger.error("❌ FastDDS库未安装，无法运行测试")
            return
        
        try:
            # 步骤1: 创建订阅器（订阅对海融合数据）
            logger.info("\n[步骤1] 创建订阅器 - 订阅对海融合数据")
            logger.info("  Topic: TrackDataClassTopic_FuseTrack")
            logger.info("  Domain ID: 142")
            self.source_receiver = DDSReceiver(
                domain_id=142,
                topic_name="TrackDataClassTopic_FuseTrack",
                profile_name="track_subscriber_source",
                discovery_server_ip="192.168.18.141",
                discovery_server_port=11611,
                multicast_ip="239.255.0.1",
                multicast_port=12359,
                data_callback=self.on_source_data_received
            )
            logger.success("  ✅ 对海融合订阅器创建成功")
            
            # 步骤2: 创建订阅器（订阅新topic）- 必须先创建订阅器
            # 注意：新topic可以使用不同的multicast_port，与源topic隔离
            logger.info("\n[步骤2] 创建订阅器 - 订阅新topic")
            logger.info("  Topic: TrackDataClassTopic_Relay")
            logger.info("  Domain ID: 142")
            logger.info("  Multicast Port: 32359 (与源topic不同)")
            self.target_receiver = DDSReceiver(
                domain_id=142,
                topic_name="TrackDataClassTopic_Relay",
                profile_name="track_subscriber_target",
                discovery_server_ip="192.168.18.141",
                discovery_server_port=11611,
                multicast_ip="239.255.0.1",
                multicast_port=32359,  # 使用不同的端口
                data_callback=self.on_target_data_received
            )
            logger.success("  ✅ 新topic订阅器创建成功")
            
            # 步骤3: 创建发布器（转发到新topic）
            # 注意：发布器必须与订阅器使用相同的multicast_port
            logger.info("\n[步骤3] 创建发布器 - 转发到新topic")
            logger.info("  Topic: TrackDataClassTopic_Relay")
            logger.info("  Domain ID: 142")
            logger.info("  Multicast Port: 32359 (与步骤2相同)")
            self.relay_publisher = DDSPublisher(
                domain_id=142,
                topic_name="TrackDataClassTopic_Relay",
                profile_name="track_publisher_relay",
                discovery_server_ip="192.168.18.141",
                discovery_server_port=11611,
                multicast_ip="239.255.0.1",
                multicast_port=32359  # 必须与订阅器相同
            )
            logger.success("  ✅ 转发发布器创建成功")
            
            # 等待发现订阅者
            logger.info("  ⏳ 等待发现订阅者...")
            self.relay_publisher.wait_discovery(timeout=5.0)
            
            logger.info("\n" + "=" * 80)
            logger.success("✅ 所有组件创建成功！")
            logger.info("📊 数据流向:")
            logger.info("  1️⃣  对海融合系统 → TrackDataClassTopic_FuseTrack")
            logger.info("  2️⃣  订阅器接收 → 转发发布器")
            logger.info("  3️⃣  转发发布器 → TrackDataClassTopic_Relay")
            logger.info("  4️⃣  新订阅器接收 → 验证完成")
            logger.info("=" * 80)
            logger.info("🚀 开始监听数据流转，按Ctrl+C停止...")
            logger.info("=" * 80)
            
            self.running = True
            
            # 持续运行，等待数据
            try:
                while self.running:
                    time.sleep(1)
            except KeyboardInterrupt:
                logger.info("\n⚠️ 接收到停止信号")
                self.running = False
            
        except Exception as e:
            logger.error(f"❌ 测试失败: {e}", exc_info=True)
        finally:
            self.stop()
    
    def stop(self):
        """停止所有组件"""
        logger.info("\n" + "=" * 80)
        logger.info("📊 统计信息:")
        logger.info(f"  📥 接收对海融合数据: {self.received_count} 条")
        logger.info(f"  📤 转发到新topic: {self.forwarded_count} 条")
        logger.info(f"  ✅ 从新topic接收: {self.final_received_count} 条")
        logger.info("=" * 80)
        
        # 清理资源
        try:
            if self.source_receiver:
                self.source_receiver.delete()
                logger.info("✅ 对海融合订阅器已清理")
        except:
            pass
        
        try:
            if self.relay_publisher:
                self.relay_publisher.delete()
                logger.info("✅ 转发发布器已清理")
        except:
            pass
        
        try:
            if self.target_receiver:
                self.target_receiver.delete()
                logger.info("✅ 新topic订阅器已清理")
        except:
            pass
        
        logger.info("=" * 80)
        logger.info("测试完成")


if __name__ == '__main__':
    flow = DDSDataFlow()
    flow.start()
