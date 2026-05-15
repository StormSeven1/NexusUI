"""
DDS数据解析器
根据structure_type选择对应的解析函数
"""
from typing import Dict, Optional, Any
from loguru import logger
import json
import os
from datetime import datetime

# 无人机数据存储开关 - 设置为False即可关闭所有存储
ENABLE_DRONE_DATA_STORAGE = True



def parse_dds_data(dds_object, structure_type: str) -> Optional[Dict[str, Any]]:
    """
    根据结构类型解析DDS对象
    
    Args:
        dds_object: DDS数据对象
        structure_type: 结构类型
            - fusion_track: 融合航迹
            - track: 通用航迹
            - radar_track: 雷达航迹
            - ais_track: AIS航迹
            - alarm_event / alarm_data: 威胁告警事件
            - Camera / camera_status: 相机实时状态
            - MultiCameraTrack / multi_track_result: 多目标检测框
            - SingleCameraTrack / single_track_result: 单目标检测框
            - uav_image_track: 无人机图像定位航迹
            - dock_status: 机场实时状态
            - drone_status: 无人机实时状态
            - drone_task: 无人机任务状态
            - high_freq: 高频位置数据
        
    Returns:
        解析后的字典，失败返回None
    """
    try:
        # 根据结构类型选择解析函数
        if structure_type in ['fusion_track', 'track']:
            return _parse_fusion_track(dds_object)
        elif structure_type == 'radar_track':
            return _parse_radar_track(dds_object)
        elif structure_type == 'ais_track':
            return _parse_ais_track(dds_object)
        elif structure_type in ['alarm_event', 'alarm_data']:
            return _parse_alarm_event(dds_object)
        elif structure_type in ['Camera', 'camera_status']:
            return _parse_camera_status(dds_object)
        elif structure_type in ['MultiCameraTrack', 'multi_track_result']:
            return _parse_multi_track_result(dds_object)
        elif structure_type in ['SingleCameraTrack', 'single_track_result']:
            return _parse_single_track_result(dds_object)
        elif structure_type == 'uav_image_track':
            return _parse_uav_image_track(dds_object)
        elif structure_type == 'radar_status':
            return _parse_radar_status(dds_object)
        elif structure_type == 'dock_status':
            return _parse_dock_status(dds_object)
        elif structure_type == 'drone_status':
            return _parse_drone_status(dds_object)
        elif structure_type == 'drone_task':
            return _parse_drone_task(dds_object)
        elif structure_type == 'high_freq':
            return _parse_high_freq(dds_object)
        elif structure_type == 'new_track_struct':
            return _parse_new_track_struct(dds_object)
        else:
            logger.warning(f"未知的DDS结构类型: {structure_type}，使用通用解析")
            return _parse_generic(dds_object, structure_type)
    except Exception as e:
        logger.error(f"解析DDS数据失败 [{structure_type}]: {e}")
        return None


def _parse_fusion_track(dds_object) -> Optional[Dict]:
    """解析融合航迹（含融合来源 fusionSources，用于前端无人机图标蓝/红）"""
    try:
        result = {
            'trackId': dds_object.trackId() if hasattr(dds_object, 'trackId') else None,
            'mmsi': dds_object.mmsi() if hasattr(dds_object, 'mmsi') else None,
            'uniqueId': dds_object.uniqueId() if hasattr(dds_object, 'uniqueId') else None,
            'longitude': dds_object.longitude() if hasattr(dds_object, 'longitude') else None,
            'latitude': dds_object.latitude() if hasattr(dds_object, 'latitude') else None,
            'height': dds_object.height() if hasattr(dds_object, 'height') else None,
            'course': dds_object.course() if hasattr(dds_object, 'course') else None,
            'speed': dds_object.speed() if hasattr(dds_object, 'speed') else None,
            'azimuth': dds_object.azimuth() if hasattr(dds_object, 'azimuth') else None,
            'range': dds_object.range() if hasattr(dds_object, 'range') else None,
            'altitude': dds_object.altitude() if hasattr(dds_object, 'altitude') else None,
            'timestamp': dds_object.timestamp() if hasattr(dds_object, 'timestamp') else None,
            'trackType': dds_object.trackType() if hasattr(dds_object, 'trackType') else None,
            'trackAlias': dds_object.trackAlias() if hasattr(dds_object, 'trackAlias') else None,
            'cpa': dds_object.cpa() if hasattr(dds_object, 'cpa') else 0,      # 添加CPA字段
            'tcpa': dds_object.tcpa() if hasattr(dds_object, 'tcpa') else 0,    # 添加TCPA字段
            'source': 'DDS',
            'data_type': 'fusion_track'
        }
        # 解析 reserved6：融合航迹时为 fusionSources JSON，供前端根据自报位 4005/4006/4007 显示蓝/红无人机图标
        if hasattr(dds_object, 'reserved6'):
            reserved6_str = dds_object.reserved6()
            if reserved6_str and reserved6_str.strip():
                try:
                    fusion_sources = json.loads(reserved6_str)
                    if isinstance(fusion_sources, list):
                        result['fusionSources'] = fusion_sources
                    elif isinstance(fusion_sources, dict):
                        result['fusionSources'] = [fusion_sources]
                    
                    # print("_parse_fusion_track:",result)
                except json.JSONDecodeError:
                    pass
                except Exception as e:
                    logger.debug(f"解析融合航迹 reserved6 失败: {e}")
        return result
    except Exception as e:
        logger.error(f"解析融合航迹失败: {e}")
        return None


def _parse_radar_track(dds_object) -> Optional[Dict]:
    """解析雷达航迹"""
    try:
        result = {
            'trackId': dds_object.trackId() if hasattr(dds_object, 'trackId') else None,
            'longitude': dds_object.longitude() if hasattr(dds_object, 'longitude') else None,
            'latitude': dds_object.latitude() if hasattr(dds_object, 'latitude') else None,
            'uniqueId': dds_object.uniqueId() if hasattr(dds_object, 'uniqueId') else None,
            'altitude': dds_object.altitude() if hasattr(dds_object, 'altitude') else None,
            'height': dds_object.height() if hasattr(dds_object, 'height') else None,
            'course': dds_object.course() if hasattr(dds_object, 'course') else None,
            'speed': dds_object.speed() if hasattr(dds_object, 'speed') else None,
            'azimuth': dds_object.azimuth() if hasattr(dds_object, 'azimuth') else None,
            'range': dds_object.range() if hasattr(dds_object, 'range') else None,
            'timestamp': dds_object.timestamp() if hasattr(dds_object, 'timestamp') else None,
            'cpa': dds_object.cpa() if hasattr(dds_object, 'cpa') else 0,      # 添加CPA字段
            'tcpa': dds_object.tcpa() if hasattr(dds_object, 'tcpa') else 0,    # 添加TCPA字段
            'source': 'DDS',
            'data_type': 'radar_track'
        }
        
          # 解析reserved6字段 - 无人机自报位特有数据
        if hasattr(dds_object, 'reserved6'):
            reserved6_str = dds_object.reserved6()
            if reserved6_str and reserved6_str.strip():
                try:
                    import json
                    uav_extra_data = json.loads(reserved6_str)
                    # 将无人机特有字段合并到result中
                    if isinstance(uav_extra_data, dict):
                        result['attitude_head'] = uav_extra_data.get('attitude_head')
                        result['attitude_pitch'] = uav_extra_data.get('attitude_pitch')
                        result['attitude_roll'] = uav_extra_data.get('attitude_roll')
                        result['gimbal_pitch'] = uav_extra_data.get('gimbal_pitch')
                        result['gimbal_roll'] = uav_extra_data.get('gimbal_roll')
                        result['gimbal_yaw'] = uav_extra_data.get('gimbal_yaw')
                        result['sn'] = uav_extra_data.get('sn', '')
                        result['device_name'] = uav_extra_data.get('device_name', '')
                        # 标记为无人机自报位数据
                        result['is_uav_self_report'] = True
                except json.JSONDecodeError as e:
                    logger.debug(f"reserved6字段不是有效的JSON: {e}")
                except Exception as e:
                    logger.debug(f"解析reserved6字段失败: {e}")
        return result
    except Exception as e:
        logger.error(f"解析雷达航迹失败: {e}")
        return None


def _parse_ais_track(dds_object) -> Optional[Dict]:
    """解析AIS航迹"""
    try:
        result = {
            'trackId': dds_object.trackId() if hasattr(dds_object, 'trackId') else None,
            'mmsi': dds_object.mmsi() if hasattr(dds_object, 'mmsi') else None,
            'uniqueId': dds_object.uniqueId() if hasattr(dds_object, 'uniqueId') else None,
            'longitude': dds_object.longitude() if hasattr(dds_object, 'longitude') else None,
            'latitude': dds_object.latitude() if hasattr(dds_object, 'latitude') else None,
            'height': dds_object.height() if hasattr(dds_object, 'height') else None,
            'course': dds_object.course() if hasattr(dds_object, 'course') else None,
            'speed': dds_object.speed() if hasattr(dds_object, 'speed') else None,
            'timestamp': dds_object.timestamp() if hasattr(dds_object, 'timestamp') else None,
            'trackAlias': dds_object.trackAlias() if hasattr(dds_object, 'trackAlias') else None,
            'cpa': dds_object.cpa() if hasattr(dds_object, 'cpa') else 0,      # 添加CPA字段
            'tcpa': dds_object.tcpa() if hasattr(dds_object, 'tcpa') else 0,    # 添加TCPA字段
            'source': 'DDS',
            'data_type': 'ais_track'
        }
        return result
    except Exception as e:
        logger.error(f"解析AIS航迹失败: {e}")
        return None


def _parse_alarm_event(dds_object) -> Optional[Dict]:
    """解析告警事件（AlarmEvent 继承自 BaseEvent）"""
    try:
        result = {
            'event_type': 'alarm',
            # BaseEvent 字段
            'eventId': dds_object.eventId() if hasattr(dds_object, 'eventId') else None,
            'sourceId': dds_object.sourceId() if hasattr(dds_object, 'sourceId') else None,
            'sourceType': dds_object.sourceType() if hasattr(dds_object, 'sourceType') else None,
            'severity': dds_object.severity() if hasattr(dds_object, 'severity') else None,
            'message': dds_object.message() if hasattr(dds_object, 'message') else None,
            'timestamp': dds_object.timestamp() if hasattr(dds_object, 'timestamp') else None,
            'userId': dds_object.userId() if hasattr(dds_object, 'userId') else None,
            'deviceId': list(dds_object.deviceId()) if hasattr(dds_object, 'deviceId') else [],
            # AlarmEvent 字段
            'alarms': [],
            'source': 'DDS',
            'data_type': 'alarm_event'
        }
        
        if hasattr(dds_object, 'alarm'):
            alarm_list = dds_object.alarm()
            for alarm in alarm_list:
                alarm_data = {
                    'alarmId': alarm.alarmId() if hasattr(alarm, 'alarmId') else None,
                    'alarmType': list(alarm.alarmType()) if hasattr(alarm, 'alarmType') else [],
                    'status': alarm.status() if hasattr(alarm, 'status') else None,
                    'taskStatus': alarm.taskStatus() if hasattr(alarm, 'taskStatus') else None,
                    'alarmContent': alarm.alarmContent() if hasattr(alarm, 'alarmContent') else None,
                    'alarmLevel': alarm.alarmLevel() if hasattr(alarm, 'alarmLevel') else None,
                    'areaId': alarm.areaId() if hasattr(alarm, 'areaId') else None,
                    'areaName': alarm.areaName() if hasattr(alarm, 'areaName') else None,
                    'trackId': alarm.trackId() if hasattr(alarm, 'trackId') else None,
                    'classId': alarm.classId() if hasattr(alarm, 'classId') else None,
                    'behaviorId': alarm.behaviorId() if hasattr(alarm, 'behaviorId') else None,
                    'updateTime': alarm.updateTime() if hasattr(alarm, 'updateTime') else None,
                    'resolvedTime': alarm.resolvedTime() if hasattr(alarm, 'resolvedTime') else None,
                    'resolvedBy': alarm.resolvedBy() if hasattr(alarm, 'resolvedBy') else None,
                    'resolutionDetails': alarm.resolutionDetails() if hasattr(alarm, 'resolutionDetails') else None,
                    'alarmRuleId': list(alarm.alarmRuleId()) if hasattr(alarm, 'alarmRuleId') else [],
                }
                
                # 位置信息
                if hasattr(alarm, 'position'):
                    position = alarm.position()
                    alarm_data['position'] = {
                        'longitude': position.longitude() if hasattr(position, 'longitude') else None,
                        'latitude': position.latitude() if hasattr(position, 'latitude') else None,
                        'altitude': position.altitude() if hasattr(position, 'altitude') else None,
                    }
                
                # 目标检测框信息
                if hasattr(alarm, 'targetBox'):
                    target_box = alarm.targetBox()
                    alarm_data['targetBox'] = {
                        'cameraId': target_box.cameraId() if hasattr(target_box, 'cameraId') else None,
                        'syncHeader': target_box.syncHeader() if hasattr(target_box, 'syncHeader') else None,
                        'x': target_box.x() if hasattr(target_box, 'x') else None,
                        'y': target_box.y() if hasattr(target_box, 'y') else None,
                        'width': target_box.width() if hasattr(target_box, 'width') else None,
                        'height': target_box.height() if hasattr(target_box, 'height') else None,
                        'boxId': target_box.boxId() if hasattr(target_box, 'boxId') else None,
                        'trackId': target_box.trackId() if hasattr(target_box, 'trackId') else None,
                        'classId': target_box.classId() if hasattr(target_box, 'classId') else None,
                        'behaviorId': target_box.behaviorId() if hasattr(target_box, 'behaviorId') else None,
                    }
                
                # 航迹信息
                if hasattr(alarm, 'track'):
                    track = alarm.track()
                    alarm_data['track'] = {
                        'trackId': track.trackId() if hasattr(track, 'trackId') else None,
                        'mmsi': track.mmsi() if hasattr(track, 'mmsi') else None,
                        'longitude': track.longitude() if hasattr(track, 'longitude') else None,
                        'latitude': track.latitude() if hasattr(track, 'latitude') else None,
                        'course': track.course() if hasattr(track, 'course') else None,
                        'speed': track.speed() if hasattr(track, 'speed') else None,
                        'height': track.height() if hasattr(track, 'height') else None,
                        'timeStamp': track.timeStamp() if hasattr(track, 'timeStamp') else None,
                        'trackType': track.trackType() if hasattr(track, 'trackType') else None,
                    }
                
                result['alarms'].append(alarm_data)
        
        print("*"*50)
        print("解析告警事件:",result)
        print("*"*50)
        return result
    except Exception as e:
        logger.error(f"解析告警事件失败: {e}")
        return None


def _parse_camera_status(dds_object) -> Optional[Dict]:
    """解析相机实时状态（CameraRealTimeStatus 继承自 BaseDeviceStatus）"""
    try:
        result = {
            # BaseDeviceStatus 字段
            'entityId': dds_object.entityId() if hasattr(dds_object, 'entityId') else None,
            'taskType': dds_object.taskType() if hasattr(dds_object, 'taskType') else None,
            'executionState': dds_object.executionState() if hasattr(dds_object, 'executionState') else None,
            'executionTimeMs': dds_object.executionTimeMs() if hasattr(dds_object, 'executionTimeMs') else None,
            'online': dds_object.online() if hasattr(dds_object, 'online') else None,
            'elec': dds_object.elec() if hasattr(dds_object, 'elec') else None,
            'timestamp': dds_object.timestamp() if hasattr(dds_object, 'timestamp') else None,
            # CameraRealTimeStatus 字段（EntityRealTimeStatus IDL）
            'focus': dds_object.focus() if hasattr(dds_object, 'focus') else None,
            'panoOffset': dds_object.panoOffset() if hasattr(dds_object, 'panoOffset') else None,
            'trackID': dds_object.trackID() if hasattr(dds_object, 'trackID') else None,
            'visibility': dds_object.visibility() if hasattr(dds_object, 'visibility') else None,
            'speedParam': dds_object.speedParam() if hasattr(dds_object, 'speedParam') else None,
            'rootPos': dds_object.rootPos() if hasattr(dds_object, 'rootPos') else None,
            'source': 'DDS',
            'data_type': 'camera_status'
        }
        
        # PTZ信息
        if hasattr(dds_object, 'ptz'):
            ptz = dds_object.ptz()
            result['ptz'] = {
                'pan': ptz.pan() if hasattr(ptz, 'pan') else None,
                'tilt': ptz.tilt() if hasattr(ptz, 'tilt') else None,
                'zoom': ptz.zoom() if hasattr(ptz, 'zoom') else None,
            }
        
        # 原始PTZ信息（带偏移值）
        if hasattr(dds_object, 'originPtz'):
            origin_ptz = dds_object.originPtz()
            result['originPtz'] = {
                'pan': origin_ptz.pan() if hasattr(origin_ptz, 'pan') else None,
                'tilt': origin_ptz.tilt() if hasattr(origin_ptz, 'tilt') else None,
                'zoom': origin_ptz.zoom() if hasattr(origin_ptz, 'zoom') else None,
            }
        
        # FOV信息
        if hasattr(dds_object, 'fov'):
            fov = dds_object.fov()
            result['fov'] = {
                'horizontal': fov.hs() if hasattr(fov, 'hs') else None,
                'vertical': fov.vs() if hasattr(fov, 'vs') else None,
            }
        
        # 位置信息
        if hasattr(dds_object, 'position'):
            position = dds_object.position()
            result['position'] = {
                'longitude': position.longitude() if hasattr(position, 'longitude') else None,
                'latitude': position.latitude() if hasattr(position, 'latitude') else None,
                'altitude': position.altitude() if hasattr(position, 'altitude') else None,
            }
        print("*"*50)
        print("解析相机状态")
        print("*"*50)

        # print("*"*50)
        # print("解析相机状态:",result)
        # print("*"*50)
        return result
    except Exception as e:
        logger.error(f"解析相机状态失败: {e}")
        return None


def _parse_multi_track_result(dds_object) -> Optional[Dict]:
    """解析多目标检测框"""
    try:
        result = {
            'cameraId': dds_object.cameraId() if hasattr(dds_object, 'cameraId') else None,
            'syncHeader': dds_object.syncHeader() if hasattr(dds_object, 'syncHeader') else None,
            'boxCount': dds_object.boxCount() if hasattr(dds_object, 'boxCount') else None,
            'boxes': [],
            'source': 'DDS',
            'data_type': 'multi_track_result'
        }
        
        if hasattr(dds_object, 'boxes'):
            boxes = dds_object.boxes()
            for box in boxes:
                box_data = {
                    'x': box.x() if hasattr(box, 'x') else None,
                    'y': box.y() if hasattr(box, 'y') else None,
                    'width': box.width() if hasattr(box, 'width') else None,
                    'height': box.height() if hasattr(box, 'height') else None,
                    'boxId': box.boxId() if hasattr(box, 'boxId') else None,
                    'classId': box.classId() if hasattr(box, 'classId') else None,
                }
                result['boxes'].append(box_data)
        
        return result
    except Exception as e:
        logger.error(f"解析多目标检测框失败: {e}")
        return None


def _parse_single_track_result(dds_object) -> Optional[Dict]:
    """解析单目标检测框"""
    try:
        result = {
            'cameraId': dds_object.cameraId() if hasattr(dds_object, 'cameraId') else None,
            'syncHeader': dds_object.syncHeader() if hasattr(dds_object, 'syncHeader') else None,
            'boxCount': dds_object.boxCount() if hasattr(dds_object, 'boxCount') else None,
            'source': 'DDS',
            'data_type': 'single_track_result'
        }
        
        # 单个检测框信息
        if hasattr(dds_object, 'box'):
            box = dds_object.box()
            result['box'] = {
                'x': box.x() if hasattr(box, 'x') else None,
                'y': box.y() if hasattr(box, 'y') else None,
                'width': box.width() if hasattr(box, 'width') else None,
                'height': box.height() if hasattr(box, 'height') else None,
                'boxId': box.boxId() if hasattr(box, 'boxId') else None,
                'classId': box.classId() if hasattr(box, 'classId') else None,
            }
        
        return result
    except Exception as e:
        logger.error(f"解析单目标检测框失败: {e}")
        return None


def _parse_uav_image_track(dds_object) -> Optional[Dict]:
    """解析无人机图像定位航迹"""
    try:
        result = {
            'trackId': dds_object.trackId() if hasattr(dds_object, 'trackId') else None,
            'uavId': dds_object.uavId() if hasattr(dds_object, 'uavId') else None,
            'longitude': dds_object.longitude() if hasattr(dds_object, 'longitude') else None,
            'latitude': dds_object.latitude() if hasattr(dds_object, 'latitude') else None,
            'altitude': dds_object.altitude() if hasattr(dds_object, 'altitude') else None,
            'timestamp': dds_object.timestamp() if hasattr(dds_object, 'timestamp') else None,
            'source': 'DDS',
            'data_type': 'uav_image_track'
        }
        
        # 无人机姿态
        if hasattr(dds_object, 'attitude'):
            attitude = dds_object.attitude()
            result['attitude'] = {
                'roll': attitude.roll() if hasattr(attitude, 'roll') else None,
                'pitch': attitude.pitch() if hasattr(attitude, 'pitch') else None,
                'yaw': attitude.yaw() if hasattr(attitude, 'yaw') else None,
            }
        
        # 云台角度
        if hasattr(dds_object, 'gimbal'):
            gimbal = dds_object.gimbal()
            result['gimbal'] = {
                'roll': gimbal.roll() if hasattr(gimbal, 'roll') else None,
                'pitch': gimbal.pitch() if hasattr(gimbal, 'pitch') else None,
                'yaw': gimbal.yaw() if hasattr(gimbal, 'yaw') else None,
            }
        print("*"*50)
        print("解析无人机图像航迹:",result)
        print("*"*50)
        
        # 存储到文件（如果开关开启）
        if ENABLE_DRONE_DATA_STORAGE:
            try:
                result['timestamp'] = datetime.now().isoformat()
                storage_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'drone_logs')
                os.makedirs(storage_dir, exist_ok=True)
                
                date_str = datetime.now().strftime('%Y-%m-%d')
                filename = f"uav_image_track_{date_str}.jsonl"
                filepath = os.path.join(storage_dir, filename)
                
                with open(filepath, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(result, ensure_ascii=False) + '\n')
            except Exception as e:
                logger.error(f"存储无人机图像航迹失败: {e}")
        
        return result
    except Exception as e:
        logger.error(f"解析无人机图像航迹失败: {e}")
        return None

def _parse_radar_status(dds_object) -> Optional[Dict]:
    """解析雷达实时状态（EntityRealTimeStatus IDL - RadarRealTimeStatus）"""
    try:
        result = {
            # BaseDeviceStatus 字段
            'entityId': dds_object.entityId() if hasattr(dds_object, 'entityId') else None,
            'online': dds_object.online() if hasattr(dds_object, 'online') else None,
            'timestamp': dds_object.timestamp() if hasattr(dds_object, 'timestamp') else None,
            # RadarRealTimeStatus 专有字段
            'radarID': dds_object.radarID() if hasattr(dds_object, 'radarID') else None,
            'radarType': dds_object.radarType() if hasattr(dds_object, 'radarType') else None,
            'radarName': dds_object.radarName() if hasattr(dds_object, 'radarName') else None,
            'longitude': dds_object.longitude() if hasattr(dds_object, 'longitude') else None,
            'latitude': dds_object.latitude() if hasattr(dds_object, 'latitude') else None,
            'transmit': dds_object.transmit() if hasattr(dds_object, 'transmit') else None,
            'range': dds_object.range() if hasattr(dds_object, 'range') else None,
            'pluseWidth': dds_object.pluseWidth() if hasattr(dds_object, 'pluseWidth') else None,
            'aziOffset': dds_object.aziOffset() if hasattr(dds_object, 'aziOffset') else None,
            'rangeOffset': dds_object.rangeOffset() if hasattr(dds_object, 'rangeOffset') else None,
            'sampleRate': dds_object.sampleRate() if hasattr(dds_object, 'sampleRate') else None,
            'gain': dds_object.gain() if hasattr(dds_object, 'gain') else None,
            'seaClutter': dds_object.seaClutter() if hasattr(dds_object, 'seaClutter') else None,
            'rainClutter': dds_object.rainClutter() if hasattr(dds_object, 'rainClutter') else None,
            'inhibit1': dds_object.inhibit1() if hasattr(dds_object, 'inhibit1') else None,
            'inhibit1StartAzi': dds_object.inhibit1StartAzi() if hasattr(dds_object, 'inhibit1StartAzi') else None,
            'inhibit1EndAzi': dds_object.inhibit1EndAzi() if hasattr(dds_object, 'inhibit1EndAzi') else None,
            'inhibit2': dds_object.inhibit2() if hasattr(dds_object, 'inhibit2') else None,
            'inhibit2StartAzi': dds_object.inhibit2StartAzi() if hasattr(dds_object, 'inhibit2StartAzi') else None,
            'inhibit2EndAzi': dds_object.inhibit2EndAzi() if hasattr(dds_object, 'inhibit2EndAzi') else None,
            'source': 'DDS',
            'data_type': 'radar_status'
        }
        print("*"*50)
        print("解析雷达实时状态")
        print("*"*50)

        return result
    except Exception as e:
        logger.error(f"解析雷达状态失败: {e}")
        return None


def _parse_dock_status(dds_object) -> Optional[Dict]:
    """解析机场实时状态"""
    try:
        result = {
            'dock_sn': dds_object.dock_sn() if hasattr(dds_object, 'dock_sn') else None,
            'latitude': dds_object.latitude() if hasattr(dds_object, 'latitude') else None,
            'longitude': dds_object.longitude() if hasattr(dds_object, 'longitude') else None,
            'height': dds_object.height() if hasattr(dds_object, 'height') else None,
            'drone_in_dock': dds_object.drone_in_dock() if hasattr(dds_object, 'drone_in_dock') else None,
            'temperature': dds_object.temperature() if hasattr(dds_object, 'temperature') else None,
            'humidity': dds_object.humidity() if hasattr(dds_object, 'humidity') else None,
            'mode_code': dds_object.mode_code() if hasattr(dds_object, 'mode_code') else None,
            'source': 'DDS',
            'data_type': 'dock_status'
        }
        # 解析无人机充电状态（电量百分比）
        if hasattr(dds_object, 'drone_charge_state'):
            charge = dds_object.drone_charge_state()
            result['battery_capacity_percent'] = charge.capacity_percent() if hasattr(charge, 'capacity_percent') else None
        # print("*"*50)
        # print("解析机场实时状态:",result)
        # print("*"*50)

        print("*"*50)
        print("解析机场实时状态")
        print("*"*50)

        return result
    except Exception as e:
        logger.error(f"解析机场状态失败: {e}")
        return None


def _parse_drone_status(dds_object) -> Optional[Dict]:
    """解析无人机实时状态"""
    try:
        # 获取飞行模式代码
        mode_code = None
        if hasattr(dds_object, 'mode_code'):
            mode_code = dds_object.mode_code()
        
        # 定义需要过滤的状态
        filtered_modes = {
            0: 'STANDBY',
            1: 'TAKEOFF_PREPARING', 
            2: 'TAKEOFF_READY',
            4: 'AUTO_TAKEOFF',
            14: 'DISCONNECTED'
        }
        
        # 如果是过滤状态，返回None不发送
        if mode_code in filtered_modes:
            print(f"[过滤] 无人机状态 {filtered_modes[mode_code]}，不发送到前端")
            return None
        
        result = {
            'drone_sn': dds_object.drone_sn() if hasattr(dds_object, 'drone_sn') else None,
            'track_id': dds_object.track_id() if hasattr(dds_object, 'track_id') else None,
            'latitude': dds_object.latitude() if hasattr(dds_object, 'latitude') else None,
            'longitude': dds_object.longitude() if hasattr(dds_object, 'longitude') else None,
            'height': dds_object.height() if hasattr(dds_object, 'height') else None,
            'attitude_head': dds_object.attitude_head() if hasattr(dds_object, 'attitude_head') else None,
            'attitude_pitch': dds_object.attitude_pitch() if hasattr(dds_object, 'attitude_pitch') else None,
            'attitude_roll': dds_object.attitude_roll() if hasattr(dds_object, 'attitude_roll') else None,
            'horizontal_speed': dds_object.horizontal_speed() if hasattr(dds_object, 'horizontal_speed') else None,
            'vertical_speed': dds_object.vertical_speed() if hasattr(dds_object, 'vertical_speed') else None,
            'mode_code': mode_code,
            'source': 'DDS',
            'data_type': 'drone_status'
        }
        
        # 解析云台信息
        if hasattr(dds_object, 'type_subtype_gimbalindex'):
            gimbal = dds_object.type_subtype_gimbalindex()
            result['gimbal_pitch'] = gimbal.gimbal_pitch() if hasattr(gimbal, 'gimbal_pitch') else None
            result['gimbal_roll'] = gimbal.gimbal_roll() if hasattr(gimbal, 'gimbal_roll') else None
            result['gimbal_yaw'] = gimbal.gimbal_yaw() if hasattr(gimbal, 'gimbal_yaw') else None
        
        # 解析电池信息
        if hasattr(dds_object, 'battery'):
            battery = dds_object.battery()
            result['battery_percent'] = battery.capacity_percent() if hasattr(battery, 'capacity_percent') else None
        
        print("*"*50)
        print("解析无人机状态:",mode_code,result['latitude'],result['longitude'],result['gimbal_pitch'])
        print("*"*50)
        

        # 存储到文件（如果开关开启）
        if ENABLE_DRONE_DATA_STORAGE:
            try:
                result['timestamp'] = datetime.now().isoformat()
                storage_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'drone_logs')
                os.makedirs(storage_dir, exist_ok=True)
                
                date_str = datetime.now().strftime('%Y-%m-%d')
                filename = f"drone_status_{date_str}.jsonl"
                filepath = os.path.join(storage_dir, filename)
                
                with open(filepath, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(result, ensure_ascii=False) + '\n')
            except Exception as e:
                logger.error(f"存储无人机状态失败: {e}")
        
        return result
    except Exception as e:
        logger.error(f"解析无人机状态失败: {e}")
        return None


def _parse_drone_task(dds_object) -> Optional[Dict]:
    """解析无人机任务状态（EntityRealTimeStatus IDL - DroneTaskRealTimeStatus）"""
    try:
        result = {
            'entityId': dds_object.entityId() if hasattr(dds_object, 'entityId') else None,
            'taskType': dds_object.taskType() if hasattr(dds_object, 'taskType') else None,
            'executionState': dds_object.executionState() if hasattr(dds_object, 'executionState') else None,
            'online': dds_object.online() if hasattr(dds_object, 'online') else None,
            'drone_state': dds_object.drone_state() if hasattr(dds_object, 'drone_state') else None,
            'drone_task_action': dds_object.drone_task_action() if hasattr(dds_object, 'drone_task_action') else None,
            'drone_task_targetID': dds_object.drone_task_targetID() if hasattr(dds_object, 'drone_task_targetID') else None,
            'waypoints': [],
            'source': 'DDS',
            'data_type': 'drone_task'
        }
        
        # 解析位置信息
        if hasattr(dds_object, 'position'):
            position = dds_object.position()
            result['position'] = {
                'longitude': position.longitude() if hasattr(position, 'longitude') else None,
                'latitude': position.latitude() if hasattr(position, 'latitude') else None,
                'altitude': position.altitude() if hasattr(position, 'altitude') else None,
            }
        
        # 解析当前航线
        if hasattr(dds_object, 'current_wayline'):
            wayline = dds_object.current_wayline()
            if hasattr(wayline, 'way_point_list'):
                waypoint_list = wayline.way_point_list()
                for wp in waypoint_list:
                    waypoint = {
                        'index': wp.index() if hasattr(wp, 'index') else None,
                        'latitude': wp.latitude() if hasattr(wp, 'latitude') else None,
                        'longitude': wp.longitude() if hasattr(wp, 'longitude') else None,
                        'height': wp.height() if hasattr(wp, 'height') else None,
                        'speed': wp.speed() if hasattr(wp, 'speed') else None,
                    }
                    result['waypoints'].append(waypoint)
        # result['waypoints']=[
        #     { 'index': 0,
        #                 'longitude': 122.089, 
        #                 'latitude': 37.545,
        #                 'height': 100,
        #                 'speed': 10},
        #                 { 'index': 1,
        #                 'longitude': 122.189, 
        #                 'latitude': 37.645,
        #                 'height': 100,
        #                 'speed': 10}]
        # print("*"*50)
        # print("解析无人机任务:",result)
        # print("*"*50)
        print("*"*50)
        print("解析无人机任务")
        print("*"*50)
        # 存储到文件（如果开关开启）
        if ENABLE_DRONE_DATA_STORAGE:
            try:
                result['timestamp'] = datetime.now().isoformat()
                storage_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'drone_logs')
                os.makedirs(storage_dir, exist_ok=True)
                
                date_str = datetime.now().strftime('%Y-%m-%d')
                filename = f"drone_task_{date_str}.jsonl"
                filepath = os.path.join(storage_dir, filename)
                
                with open(filepath, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(result, ensure_ascii=False) + '\n')
            except Exception as e:
                logger.error(f"存储无人机任务失败: {e}")
        
        return result
    except Exception as e:
        logger.error(f"解析无人机任务失败: {e}")
        return None


def _parse_high_freq(dds_object) -> Optional[Dict]:
    """解析高频位置数据"""
    try:
        result = {
            'drone_sn': dds_object.drone_sn() if hasattr(dds_object, 'drone_sn') else None,
            'dock_sn': dds_object.dock_sn() if hasattr(dds_object, 'dock_sn') else None,
            'latitude': dds_object.latitude() if hasattr(dds_object, 'latitude') else None,
            'longitude': dds_object.longitude() if hasattr(dds_object, 'longitude') else None,
            'height': dds_object.height() if hasattr(dds_object, 'height') else None,
            'attitude_head': dds_object.attitude_head() if hasattr(dds_object, 'attitude_head') else None,
            'speed_x': dds_object.speed_x() if hasattr(dds_object, 'speed_x') else None,
            'speed_y': dds_object.speed_y() if hasattr(dds_object, 'speed_y') else None,
            'speed_z': dds_object.speed_z() if hasattr(dds_object, 'speed_z') else None,
            'gimbal_pitch': dds_object.gimbal_pitch() if hasattr(dds_object, 'gimbal_pitch') else None,
            'gimbal_roll': dds_object.gimbal_roll() if hasattr(dds_object, 'gimbal_roll') else None,
            'gimbal_yaw': dds_object.gimbal_yaw() if hasattr(dds_object, 'gimbal_yaw') else None,
            'source': 'DDS',
            'data_type': 'high_freq'
        } 
        print("*"*50)
        print("解析高频数据")
        print("*"*50)
        # print("*"*50)
        # print("解析高频数据:",result)
        # print("*"*50)
        
        # 存储到文件（如果开关开启）
        if ENABLE_DRONE_DATA_STORAGE:
            try:
                result['timestamp'] = datetime.now().isoformat()
                storage_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'drone_logs')
                os.makedirs(storage_dir, exist_ok=True)
                
                date_str = datetime.now().strftime('%Y-%m-%d')
                filename = f"high_freq_{date_str}.jsonl"
                filepath = os.path.join(storage_dir, filename)
                
                with open(filepath, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(result, ensure_ascii=False) + '\n')
            except Exception as e:
                logger.error(f"存储高频数据失败: {e}")
        
        return result
    except Exception as e:
        logger.error(f"解析高频数据失败: {e}")
        return None



def _parse_generic(dds_object, structure_type: str) -> Optional[Dict]:
    """
    通用解析器 - 尝试提取所有可能的字段
    当没有特定解析器时使用
    """
    try:
        result = {
            'source': 'DDS',
            'data_type': structure_type
        }
        
        # 常见字段列表
        common_fields = [
            'trackId', 'uniqueId', 'mmsi', 'cameraId', 'boxId', 'eventId',
            'longitude', 'latitude', 'height', 'altitude',
            'course', 'speed', 'azimuth', 'range',
            'timestamp', 'timeStamp',
            'x', 'y', 'width', 'height', 'confidence',
            'trackType', 'classId', 'behaviorId'
        ]
        
        # 尝试提取所有常见字段
        for field in common_fields:
            if hasattr(dds_object, field):
                try:
                    value = getattr(dds_object, field)()
                    result[field] = value
                except Exception:
                    pass
        
        return result if len(result) > 2 else None  # 至少要有source和data_type之外的字段
        
    except Exception as e:
        logger.error(f"通用解析失败 [{structure_type}]: {e}")
        return None


def _parse_new_track_struct(dds_object) -> Optional[Dict]:
    """
    解析 NewTrackStruct Track DDS 对象。
    输出字典格式与 _parse_fusion_track 完全一致（含 fusionSources），
    确保下游 WebSocket 推送和前端无需任何改动。
    """
    try:
        # ---- 基础标识 ----
        track_id = dds_object.trackID() if hasattr(dds_object, 'trackID') else None
        unique_id = dds_object.uniqueID() if hasattr(dds_object, 'uniqueID') else None

        # ---- 位置（嵌套 GeoPosition）----
        longitude = None
        latitude = None
        height = None
        if hasattr(dds_object, 'position'):
            pos = dds_object.position()
            longitude = pos.longitude() if hasattr(pos, 'longitude') else None
            latitude = pos.latitude() if hasattr(pos, 'latitude') else None
            height = pos.altitude() if hasattr(pos, 'altitude') else None

        # ---- 运动学 ----
        course = dds_object.heading() if hasattr(dds_object, 'heading') else None
        speed = dds_object.speed() if hasattr(dds_object, 'speed') else None

        # ---- 时间：lastUpdateTime 是微秒，转为秒给下游 ----
        timestamp_us = dds_object.lastUpdateTime() if hasattr(dds_object, 'lastUpdateTime') else None
        timestamp = int(timestamp_us / 1_000_000) if timestamp_us and timestamp_us > 0 else None

        # ---- 威胁 / 分类 / 质量 ----
        threat_level = dds_object.threatLevel() if hasattr(dds_object, 'threatLevel') else 0
        track_category_name = dds_object.trackCategoryName() if hasattr(dds_object, 'trackCategoryName') else None
        track_quality = dds_object.trackQuality() if hasattr(dds_object, 'trackQuality') else 0

        # ---- CPA / TCPA ----
        cpa = dds_object.cpaMetres() if hasattr(dds_object, 'cpaMetres') else 0
        tcpa = dds_object.tcpaSecs() if hasattr(dds_object, 'tcpaSecs') else 0

        # ---- trackType 从 domain 推导（兼容旧版前端）----
        domain_val = dds_object.domain() if hasattr(dds_object, 'domain') else 0
        # IDL TrackDomain: 0=Unknown, 1=Air, 2=Surface, 3=SubSurface, 4=Land, 5=Space
        _DOMAIN_TO_TRACK_TYPE = {0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5}
        track_type = _DOMAIN_TO_TRACK_TYPE.get(domain_val, 0)

        # ---- 速度分量 ----
        speed_e = None
        speed_n = None
        speed_v = None
        if hasattr(dds_object, 'velocity'):
            vel = dds_object.velocity()
            speed_e = vel.x() if hasattr(vel, 'x') else None
            speed_n = vel.y() if hasattr(vel, 'y') else None
            speed_v = vel.z() if hasattr(vel, 'z') else None

        # ---- 别名 / reID ----
        re_id = dds_object.reID() if hasattr(dds_object, 'reID') else None

        # ================================================================
        # 融合来源提取：遍历 TrackFusionInfo 各 FusionGroup
        # 输出格式与旧版一致: [{ sourceName, dataSourceId, trackId }, ...]
        # ================================================================
        fusion_sources = []
        if hasattr(dds_object, 'fusion'):
            fusion = dds_object.fusion()

            # --- 雷达来源 RadarFusionGroup ---
            if hasattr(fusion, 'radarFusion'):
                rg = fusion.radarFusion()
                r_count = rg.measurementCount() if hasattr(rg, 'measurementCount') else 0
                if r_count > 0:
                    meas = rg.measurements()
                    for i in range(r_count):
                        try:
                            rm = meas[i]
                            entity_id = rm.source().entityId() if hasattr(rm, 'source') else ''
                            meas_id = rm.measurementId() if hasattr(rm, 'measurementId') else 0
                            fusion_sources.append({
                                'sourceName': entity_id,
                                'dataSourceId': entity_id,
                                'trackId': meas_id,
                            })
                        except Exception:
                            pass

            # --- AIS来源 AISFusionGroup ---
            if hasattr(fusion, 'aisFusion'):
                ag = fusion.aisFusion()
                a_count = ag.measurementCount() if hasattr(ag, 'measurementCount') else 0
                if a_count > 0:
                    meas = ag.measurements()
                    for i in range(a_count):
                        try:
                            am = meas[i]
                            mmsi = am.mmsi() if hasattr(am, 'mmsi') else 0
                            vessel_name = am.vesselName() if hasattr(am, 'vesselName') else ''
                            fusion_sources.append({
                                'sourceName': 'AIS',
                                'dataSourceId': 'ais',
                                'trackId': mmsi,
                            })
                        except Exception:
                            pass

            # --- 光电来源 EOFusionGroup ---
            if hasattr(fusion, 'eoFusion'):
                eg = fusion.eoFusion()
                e_count = eg.measurementCount() if hasattr(eg, 'measurementCount') else 0
                if e_count > 0:
                    meas = eg.measurements()
                    for i in range(e_count):
                        try:
                            em = meas[i]
                            entity_id = em.source().entityId() if hasattr(em, 'source') else ''
                            meas_id = em.measurementId() if hasattr(em, 'measurementId') else 0
                            fusion_sources.append({
                                'sourceName': entity_id,
                                'dataSourceId': entity_id,
                                'trackId': meas_id,
                            })
                        except Exception:
                            pass

            # --- 无人机/自报位来源 UAVFusionGroup ---
            if hasattr(fusion, 'uavFusion'):
                ug = fusion.uavFusion()
                u_count = ug.measurementCount() if hasattr(ug, 'measurementCount') else 0
                if u_count > 0:
                    meas = ug.measurements()
                    for i in range(u_count):
                        try:
                            um = meas[i]
                            entity_id = um.source().entityId() if hasattr(um, 'source') else ''
                            meas_id = um.measurementId() if hasattr(um, 'measurementId') else 0
                            fusion_sources.append({
                                'sourceName': entity_id or 'UAV',
                                'dataSourceId': entity_id,
                                'trackId': meas_id,
                            })
                        except Exception:
                            pass

            # --- ESM来源 ESMFusionGroup ---
            if hasattr(fusion, 'esmFusion'):
                esg = fusion.esmFusion()
                es_count = esg.measurementCount() if hasattr(esg, 'measurementCount') else 0
                if es_count > 0:
                    meas = esg.measurements()
                    for i in range(es_count):
                        try:
                            esm = meas[i]
                            entity_id = esm.source().entityId() if hasattr(esm, 'source') else ''
                            meas_id = esm.measurementId() if hasattr(esm, 'measurementId') else 0
                            fusion_sources.append({
                                'sourceName': entity_id or 'ESM',
                                'dataSourceId': entity_id,
                                'trackId': meas_id,
                            })
                        except Exception:
                            pass

            # --- ADS-B来源 ADSBFusionGroup ---
            if hasattr(fusion, 'adsbFusion'):
                abg = fusion.adsbFusion()
                ab_count = abg.measurementCount() if hasattr(abg, 'measurementCount') else 0
                if ab_count > 0:
                    meas = abg.measurements()
                    for i in range(ab_count):
                        try:
                            abm = meas[i]
                            entity_id = abm.source().entityId() if hasattr(abm, 'source') else ''
                            callsign = abm.callsign() if hasattr(abm, 'callsign') else ''
                            fusion_sources.append({
                                'sourceName': entity_id or 'ADS-B',
                                'dataSourceId': entity_id,
                                'trackId': callsign,
                            })
                        except Exception:
                            pass

            # --- TDOA来源 TDOAFusionGroup ---
            if hasattr(fusion, 'tdoaFusion'):
                tg = fusion.tdoaFusion()
                t_count = tg.measurementCount() if hasattr(tg, 'measurementCount') else 0
                if t_count > 0:
                    meas = tg.measurements()
                    for i in range(t_count):
                        try:
                            tm = meas[i]
                            entity_id = tm.source().entityId() if hasattr(tm, 'source') else ''
                            meas_id = tm.measurementId() if hasattr(tm, 'measurementId') else 0
                            fusion_sources.append({
                                'sourceName': entity_id or 'TDOA',
                                'dataSourceId': entity_id,
                                'trackId': meas_id,
                            })
                        except Exception:
                            pass

        # ---- 组装结果字典（与 _parse_fusion_track 输出 key 一致）----
        result = {
            'trackId': track_id,
            'mmsi': None,
            'uniqueId': unique_id,
            'longitude': longitude,
            'latitude': latitude,
            'height': height,
            'course': course,
            'speed': speed,
            'azimuth': None,
            'range': None,
            'altitude': height,
            'timestamp': timestamp,
            'trackType': track_type,
            'trackAlias': '',
            'cpa': cpa,
            'tcpa': tcpa,
            'source': 'DDS',
            'data_type': 'fusion_track',
            'trackCategoryName': track_category_name,
            'trackQuality': track_quality,
            'threatScore': threat_level,
            'reID': re_id,
        }

        # AIS mmsi 回填（从融合来源中找）
        for fs in fusion_sources:
            if fs.get('dataSourceId') == 'ais' and fs.get('trackId'):
                result['mmsi'] = fs['trackId']
                break

        if fusion_sources:
            result['fusionSources'] = fusion_sources

        return result
    except Exception as e:
        logger.error(f"解析NewTrackStruct航迹失败: {e}")
        return None
