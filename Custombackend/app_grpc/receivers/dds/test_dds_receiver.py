#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DDS接收器测试示例
测试从配置文件动态创建DDS接收器

使用方法：
  从 backend 目录运行：
    python -m app.dds.test_dds_receiver
    python -m app.dds.test_dds_receiver simple
  
  或者从 app/dds 目录运行（使用相对导入）：
    python test_dds_receiver.py
    python test_dds_receiver.py simple
"""
import sys
import os
import time
import json
from pathlib import Path
from typing import List
from loguru import logger

# 配置日志
logger.remove()
logger.add(sys.stderr, level="INFO", format="{message}")

# 屏蔽DDS内部的print输出，避免每条数据被拆成多行（例如"Sample N RECEIVED"等）
# 仅保留本脚本输出到stderr的单行数据
_stdout_devnull = open(os.devnull, 'w')
sys.stdout = _stdout_devnull

# 添加项目根目录到Python路径
# 如果从 app/dds 目录运行，需要添加 backend 目录到路径
current_dir = Path(__file__).parent
backend_dir = current_dir.parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

try:
    from app.dds.dds_receiver import DDSReceiver
except ImportError as e:
    logger.error(f"导入DDS模块失败: {e}")
    logger.error("请确保已安装FastDDS库并正确配置环境")
    logger.error(f"当前Python路径: {sys.path}")
    logger.error(f"当前工作目录: {os.getcwd()}")
    logger.error(f"脚本所在目录: {current_dir}")
    logger.error(f"Backend目录: {backend_dir}")
    sys.exit(1)


def test_dds_receiver_with_config():
    """测试使用配置参数创建DDS接收器"""
    logger.info("DDS接收器（订阅全部转发Topic）")
    
    # 检查DDS是否可用
    if not DDSReceiver.is_available():
        logger.error("❌ FastDDS库未安装，无法运行测试")
        return
    
    def _safe_json_value(v):
        if v is None or isinstance(v, (int, float, str, bool)):
            return v
        if isinstance(v, (list, tuple)):
            return [_safe_json_value(x) for x in v]
        if isinstance(v, dict):
            return {k: _safe_json_value(val) for k, val in v.items()}
        return str(v)

    def _make_callback(topic_name: str):
        def on_data_received(data: dict):
            payload = {k: _safe_json_value(v) for k, v in (data or {}).items()}
            payload['topic'] = topic_name
            logger.info(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
        return on_data_received

    def _load_topics_from_default_config() -> List[str]:
        cfg_path = backend_dir / 'default_process_config.json'
        if not cfg_path.exists():
            return []
        try:
            cfg = json.loads(cfg_path.read_text(encoding='utf-8'))
            forward_rules = cfg.get('forwardRules') or {}
            topics = []
            for rule in forward_rules.values():
                for target in rule.get('forwardingTargets') or []:
                    if target.get('network_protocol') != 'dds':
                        continue
                    dds_cfg = target.get('dds_config') or {}
                    topic = dds_cfg.get('topic_name')
                    if topic:
                        topics.append(topic)
            # 去重并保持稳定排序
            return sorted(set(topics))
        except Exception:
            return []
    
    try:
        topics = _load_topics_from_default_config()
        if not topics:
            topics = [
                'TrackDataClassTopic_RadarTrack1',
                'TrackDataClassTopic_RadarTrack2',
                'TrackDataClassTopic_AISTrack',
                'TrackDataClassTopic_BirdRadarTrack',
                'TrackDataClassTopic_KuRadarTrack',
                'TrackDataClassTopic_FuseTrack',
                'TrackDataClassTopic_FuseBirdRadarTrack',
                'TrackDataClassTopic_UAVPoseTrack',
                'TrackDataClassTopic_AutoBirdRadarTrack',
            ]

        receivers = []
        for topic_name in topics:
            safe_topic = ''.join(ch if ch.isalnum() else '_' for ch in topic_name)
            profile_name = f"track_subscriber_forward_{safe_topic}"
            receivers.append(
                DDSReceiver(
                    domain_id=142,
                    topic_name=topic_name,
                    profile_name=profile_name,
                    discovery_server_ip="192.168.18.141",
                    discovery_server_port=11611,
                    multicast_ip="239.255.0.1",
                    multicast_port=12356,
                    data_callback=_make_callback(topic_name),
                )
            )

        logger.info(f"订阅Topic数量={len(receivers)}")

        # 持续运行，等待数据
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("停止")
        
    except Exception as e:
        logger.error(f"测试失败: {e}")
    finally:
        for r in locals().get('receivers', []):
            try:
                r.delete()
            except Exception:
                pass


def test_dds_receiver_simple():
    """测试使用默认配置创建DDS接收器"""
    logger.info("DDS接收器（默认配置）")
    
    # 检查DDS是否可用
    if not DDSReceiver.is_available():
        logger.error("❌ FastDDS库未安装，无法运行测试")
        return
    
    # 简单的数据回调
    def on_data_received(data: dict):
        payload = {k: data.get(k) for k in sorted((data or {}).keys())}
        logger.info(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    
    try:
        # 使用默认配置创建接收器
        logger.info("创建DDS接收器（默认配置）")
        receiver = DDSReceiver(data_callback=on_data_received)
        logger.info("开始接收数据")
        
        # 持续运行
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("停止")
        
    except Exception as e:
        logger.error(f"测试失败: {e}")
    finally:
        try:
            receiver.delete()
            logger.info("资源已清理")
        except:
            pass


if __name__ == '__main__':
    logger.info("DDS接收器测试程序")
    
    # 选择测试模式
    if len(sys.argv) > 1 and sys.argv[1] == 'simple':
        test_dds_receiver_simple()
    else:
        test_dds_receiver_with_config()
    
    logger.info("结束")
