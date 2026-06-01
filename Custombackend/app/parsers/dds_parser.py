"""
DDS数据解析器
根据structure_type选择对应的解析函数
"""
from typing import Dict, Optional, Any, List, Union
from loguru import logger
import json
import os
from datetime import datetime

# 无人机数据存储开关 - 设置为False即可关闭所有存储
ENABLE_DRONE_DATA_STORAGE = True


def _store_drone_jsonl(result: Dict[str, Any], log_prefix: str) -> None:
    """可选：将无人机相关 DDS 解析结果追加到 data/drone_logs/*.jsonl"""
    if not ENABLE_DRONE_DATA_STORAGE or not result:
        return
    try:
        row = {**result, "timestamp": datetime.now().isoformat()}
        storage_dir = os.path.join(os.path.dirname(__file__), "..", "data", "drone_logs")
        os.makedirs(storage_dir, exist_ok=True)
        date_str = datetime.now().strftime("%Y-%m-%d")
        filepath = os.path.join(storage_dir, f"{log_prefix}_{date_str}.jsonl")
        with open(filepath, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception as e:
        logger.error(f"存储无人机 DDS 日志失败 [{log_prefix}]: {e}")


def parse_dds_data(
    dds_object, structure_type: str
) -> Union[Dict[str, Any], List[Dict[str, Any]], None]:
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
            - camera_status: 相机实时状态（EntityRealTimeStatus / CameraRealTimeStatus）
            - MultiCameraTrack / multi_track_result: 多目标检测框
            - SingleCameraTrack / single_track_result: 单目标检测框
            - uav_image_track: 无人机图像定位航迹
            - dock_status: 机场实时状态（EntityRealTimeStatus / Dock2RealTimeStatus）
            - drone_status: 无人机实时状态（EntityRealTimeStatus / DroneRealTimeStatus）
            - drone_task: 无人机任务状态（EntityRealTimeStatus / DroneTaskRealTimeStatus）
            - high_freq: 高频位置数据（EntityRealTimeStatus / highFreqRealTimeStatus）
            - munition_status: 巡飞弹实时状态（EntityRealTimeStatus / MunitionRealTimeStatus）
            - usv_status: 无人船实时状态（EntityRealTimeStatus / USVRealTimeStatus）
            - laser_status: 激光武器实时状态（EntityRealTimeStatus / LaserRealTimeStatus）
            - tdoa_status: TDOA 实时状态（与激光同形；IDL 无独立类型时订阅 LaserRealTimeStatus）
            - new_track_struct: TrackManager NewStruct 转发 TargetOutputSet
        
    Returns:
        解析后的字典，或字典列表（new_track_struct 多目标），失败返回 None
    """
    try:
        if structure_type == 'new_track_struct':
            from parsers.new_track_struct_parser import parse_target_output_set
            return parse_target_output_set(dds_object)
        # 根据结构类型选择解析函数
        if structure_type in ['fusion_track', 'track']:
            return _parse_fusion_track(dds_object)
        elif structure_type == 'radar_track':
            return _parse_radar_track(dds_object)
        elif structure_type == 'ais_track':
            return _parse_ais_track(dds_object)
        elif structure_type in ['alarm_event', 'alarm_data']:
            return _parse_alarm_event(dds_object)
        elif structure_type == 'camera_status':
            return _parse_camera_status(dds_object)
        elif structure_type in ['MultiCameraTrack', 'multi_track_result']:
            return _parse_multi_track_result(dds_object)
        elif structure_type in ['SingleCameraTrack', 'single_track_result']:
            return _parse_single_track_result(dds_object)
        elif structure_type == 'uav_image_track':
            return _parse_uav_image_track(dds_object)  
        elif structure_type == 'dock_status':
            ret =  _parse_dock_status(dds_object)
            # print("dock_status:",ret)
            return ret
        elif structure_type == 'drone_status':
            result = _parse_drone_status(dds_object)
            if result:
                _store_drone_jsonl(result, "drone_status")
            return result
        elif structure_type == 'drone_task':
            result = _parse_drone_task(dds_object)
            if result:
                _store_drone_jsonl(result, "drone_task")
            return result
        elif structure_type == 'high_freq':
            result = _parse_high_freq(dds_object)
            if result:
                _store_drone_jsonl(result, "high_freq")
            return result
        elif structure_type == 'munition_status':
            ret= _parse_munition_status(dds_object)
            print("munition_status:",ret)
            return ret
        elif structure_type == 'usv_status':
            return _parse_usv_status(dds_object)
        elif structure_type == 'laser_status':
            ret = _parse_directed_weapon_status(
                dds_object, 'laser_status', 'laserState', ('laserState',)
            )
            print("laser_status:",ret)
            return ret
        elif structure_type == 'tdoa_status':
            ret= _parse_directed_weapon_status(
                dds_object, 'tdoa_status', 'tdoaState', ('tdoaState', 'laserState')
            )
            print("tdoa_status:",ret)
            return ret
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
            'elevation': dds_object.elevation() if hasattr(dds_object, 'elevation') else None,
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
        
        # print("*"*50)
        # print("解析告警事件:",result)
        # print("*"*50)
        return result
    except Exception as e:
        logger.error(f"解析告警事件失败: {e}")
        return None


# ── EntityRealTimeStatus（各 build/test_*.py 单 topic 订阅，字段一一对应）──

_DRONE_STATUS_FILTERED_MODES = {0, 1, 2, 4, 14}


def _dds_device_state(dds_object) -> Optional[int]:
    if hasattr(dds_object, 'deviceState'):
        try:
            return int(dds_object.deviceState())
        except Exception:
            return None
    return None


def _parse_dock_status(dds_object) -> Optional[Dict]:
    """Dock2RealTimeStatus，对齐 build/test_dock.py"""
    ps = dds_object.position_state()
    cs = dds_object.drone_charge_state()
    sd = dds_object.sub_device()
    return {
        'entityId': dds_object.entityId(),
        'online': dds_object.online(),
        'deviceState': _dds_device_state(dds_object),
        'timestamp': dds_object.timestamp(),
        'dock_sn': dds_object.dock_sn(),
        'mode_code': dds_object.mode_code(),
        'flighttask_step_code': dds_object.flighttask_step_code(),
        'cover_state': dds_object.cover_state(),
        'drone_in_dock': dds_object.drone_in_dock(),
        'temperature': dds_object.temperature(),
        'environment_temperature': dds_object.environment_temperature(),
        'humidity': dds_object.humidity(),
        'wind_speed': dds_object.wind_speed(),
        'working_voltage': dds_object.working_voltage(),
        'working_current': dds_object.working_current(),
        'alarm_state': dds_object.alarm_state(),
        'latitude': dds_object.latitude(),
        'longitude': dds_object.longitude(),
        'height': dds_object.height(),
        'firmware_version': dds_object.firmware_version(),
        'job_number': dds_object.job_number(),
        'position_state': {
            'is_calibration': ps.is_calibration(),
            'is_fixed': ps.is_fixed(),
            'quality': ps.quality(),
            'gps_number': ps.gps_number(),
            'rtk_number': ps.rtk_number(),
        },
        'battery_capacity_percent': cs.capacity_percent(),
        'sub_device': {
            'device_sn': sd.device_sn(),
            'device_online_status': sd.device_online_status(),
            'device_paired': sd.device_paired(),
        },
        'source': 'DDS',
        'data_type': 'dock_status',
        'isVirtualWeapon': bool(dds_object.isVirtualWeapon()) if hasattr(dds_object, 'isVirtualWeapon') else False,
    }


def _parse_drone_status(dds_object) -> Optional[Dict]:
    """DroneRealTimeStatus，对齐 build/test_drone.py"""
    mode_code = dds_object.mode_code()
    if mode_code in _DRONE_STATUS_FILTERED_MODES:
        return None
    bat = dds_object.battery()
    ps = dds_object.position_state()
    oa = dds_object.obstacle_avoidance()
    return {
        'entityId': dds_object.entityId(),
        'online': dds_object.online(),
        'deviceState': _dds_device_state(dds_object),
        'timestamp': dds_object.timestamp(),
        'drone_sn': dds_object.drone_sn(),
        'track_id': dds_object.track_id(),
        'mode_code': mode_code,
        'latitude': dds_object.latitude(),
        'longitude': dds_object.longitude(),
        'elevation': dds_object.elevation(),
        'height': dds_object.height(),
        'attitude_head': dds_object.attitude_head(),
        'attitude_pitch': dds_object.attitude_pitch(),
        'attitude_roll': dds_object.attitude_roll(),
        'horizontal_speed': dds_object.horizontal_speed(),
        'vertical_speed': dds_object.vertical_speed(),
        'wind_speed': dds_object.wind_speed(),
        'home_distance': dds_object.home_distance(),
        'home_latitude': dds_object.home_latitude(),
        'home_longitude': dds_object.home_longitude(),
        'control_source': dds_object.control_source(),
        'gear': dds_object.gear(),
        'height_limit': dds_object.height_limit(),
        'firmware_version': dds_object.firmware_version(),
        'battery_percent': bat.capacity_percent(),
        'position_state': {
            'is_fixed': ps.is_fixed(),
            'quality': ps.quality(),
            'gps_number': ps.gps_number(),
            'rtk_number': ps.rtk_number(),
        },
        'obstacle_avoidance': {
            'horizon': oa.horizon(),
            'upside': oa.upside(),
            'downside': oa.downside(),
        },
        'source': 'DDS',
        'data_type': 'drone_status',
        'isVirtualWeapon': bool(dds_object.isVirtualWeapon()) if hasattr(dds_object, 'isVirtualWeapon') else False,
    }


# entityId / deviceSn -> 机场 dockSn（由 entity_status relationships 同步，供任务弹药日志）
_drone_dock_sn_map: Dict[str, str] = {}


def sync_dock_sn_map_from_relationships(relationships: Optional[Dict[str, Any]]) -> None:
    """HTTP entity_status 解析后更新无人机→机场映射，供 drone_task 弹药日志打印机场 SN。"""
    if not relationships:
        return
    for ap in relationships.get('airports') or []:
        dock_sn = str(ap.get('dockSn') or ap.get('dock_sn') or '').strip()
        if not dock_sn:
            continue
        for dr in ap.get('drones') or []:
            device_sn = str(dr.get('deviceSn') or dr.get('device_sn') or '').strip()
            entity_id = str(dr.get('entityId') or dr.get('entity_id') or '').strip()
            if device_sn:
                _drone_dock_sn_map[device_sn] = dock_sn
            if entity_id:
                _drone_dock_sn_map[entity_id] = dock_sn


def _resolve_dock_sn_for_task(entity_id: str) -> str:
    eid = (entity_id or '').strip()
    if eid and eid in _drone_dock_sn_map:
        return _drone_dock_sn_map[eid]
    return ''


def _read_munition_info_raw(dds_object) -> Dict[str, Any]:
    """读取 DDS munition_info 原始字段（未做有效性归一化）。"""
    raw: Dict[str, Any] = {
        'munitionId': None,
        'name': None,
        'quantityUnits': None,
    }
    try:
        mi = dds_object.munition_info()
        try:
            raw['munitionId'] = mi.munitionId()
        except Exception:
            pass
        try:
            raw['name'] = mi.name()
        except Exception:
            pass
        try:
            raw['quantityUnits'] = int(mi.quantityUnits())
        except Exception:
            pass
    except Exception:
        pass
    return raw


def _normalize_munition_quantity_units(qty: Any) -> Optional[int]:
    """NULL / -1 / 无效值 → None（前端不渲染）；有效非负整数 → 展示。"""
    if qty is None:
        return None
    try:
        n = int(qty)
    except (TypeError, ValueError):
        return None
    if n < 0:
        return None
    return n


def _parse_drone_munition_info(dds_object) -> Dict[str, Any]:
    """DroneTaskRealTimeStatus.munition_info → 前端弹药数量展示"""
    raw = _read_munition_info_raw(dds_object)
    qty = _normalize_munition_quantity_units(raw['quantityUnits'])
    return {
        'munitionId': raw['munitionId'] if raw['munitionId'] is not None else '',
        'name': raw['name'] if raw['name'] is not None else '',
        'quantityUnits': qty,
    }


def _parse_drone_task(dds_object) -> Optional[Dict]:
    """DroneTaskRealTimeStatus，对齐 build/test_task.py"""
    target_id = dds_object.drone_task_targetID()
    wl = dds_object.current_wayline()
    wpl = wl.way_point_list()
    waypoints = []
    for i in range(len(wpl)):
        wp = wpl[i]
        waypoints.append({
            'index': wp.index(),
            'latitude': wp.latitude(),
            'longitude': wp.longitude(),
            'height': wp.height(),
            'speed': wp.speed(),
        })
    sa = dds_object.current_SearchArea()
    pos = dds_object.position()
    entity_id = dds_object.entityId()
    munition_raw = _read_munition_info_raw(dds_object)
    munition_info = _parse_drone_munition_info(dds_object)
    dock_sn = _resolve_dock_sn_for_task(entity_id)
    logger.info(
        f"[无人机任务弹药] 机场SN={dock_sn or '-'} "
        f"弹药原始quantityUnits={munition_raw['quantityUnits']!r} "
        f"解析后quantityUnits={munition_info['quantityUnits']!r} "
        f"(munitionId={munition_raw['munitionId']!r} name={munition_raw['name']!r})"
    )
    return {
        'entityId': entity_id,
        'online': dds_object.online(),
        'deviceState': _dds_device_state(dds_object),
        'timestamp': dds_object.timestamp(),
        'taskType': dds_object.taskType(),
        'executionState': dds_object.executionState(),
        'drone_state': dds_object.drone_state(),
        'drone_task_action': dds_object.drone_task_action(),
        'drone_task_targetID': target_id,
        'rev2': target_id,
        'current_wayline': {
            'wayline_id': wl.wayline_id(),
            'wayline_name': wl.wayline_name(),
            'template_type': wl.template_type(),
            'auto_flight_speed': wl.auto_flight_speed(),
            'global_height': wl.global_height(),
            'finish_action': wl.finish_action(),
        },
        'waypoints': waypoints,
        'current_SearchArea': {'area_name': sa.area_name()},
        'position': {
            'longitude': pos.longitude(),
            'latitude': pos.latitude(),
            'altitude': pos.altitude(),
        },
        'munition_info': munition_info,
        'source': 'DDS',
        'data_type': 'drone_task',
    }


def _weapon_state_value(dds_object, *method_names: str) -> int:
    for name in method_names:
        if hasattr(dds_object, name):
            try:
                return int(getattr(dds_object, name)())
            except Exception:
                continue
    return 0


def _parse_directed_weapon_status(
    dds_object,
    data_type: str,
    state_field: str,
    state_methods: tuple,
) -> Optional[Dict]:
    """LaserRealTimeStatus / 同形 TDOA；含 BaseDeviceStatus.deviceState 与目标 ID。"""
    try:
        pos = dds_object.position()
        result: Dict[str, Any] = {
            'entityId': dds_object.entityId(),
            'online': dds_object.online(),
            'deviceState': _dds_device_state(dds_object),
            'timestamp': dds_object.timestamp(),
            state_field: _weapon_state_value(dds_object, *state_methods),
            'hitPoint': float(dds_object.hitPoint()),
            'latitude': float(pos.latitude()),
            'longitude': float(pos.longitude()),
            'altitude': float(pos.altitude()),
            'source': 'DDS',
            'data_type': data_type,
        }
        if hasattr(dds_object, 'taskType'):
            result['taskType'] = dds_object.taskType()
        if hasattr(dds_object, 'executionState'):
            result['executionState'] = int(dds_object.executionState())
        if hasattr(dds_object, 'executionTimeMs'):
            result['executionTimeMs'] = int(dds_object.executionTimeMs())
        if hasattr(dds_object, 'elec'):
            result['elec'] = float(dds_object.elec())
        if hasattr(dds_object, 'isVirtualWeapon'):
            result['isVirtualWeapon'] = bool(dds_object.isVirtualWeapon())
        if hasattr(dds_object, 'dispositionType'):
            result['dispositionType'] = int(dds_object.dispositionType())
        if hasattr(dds_object, 'entityType'):
            result['entityType'] = int(dds_object.entityType())
        if hasattr(dds_object, 'targetID'):
            result['targetID'] = dds_object.targetID()
        if hasattr(dds_object, 'targetName'):
            result['targetName'] = dds_object.targetName()
        if hasattr(dds_object, 'targetType'):
            result['targetType'] = int(dds_object.targetType())
        lat = result.get('latitude')
        lng = result.get('longitude')
        if lat is None or lng is None or not (-90 <= float(lat) <= 90) or not (-180 <= float(lng) <= 180):
            return None
        return result
    except Exception as e:
        logger.error(f"解析定向武器状态失败 [{data_type}]: {e}")
        return None


def _parse_usv_status(dds_object) -> Optional[Dict]:
    """USVRealTimeStatus（无人船）；位置优先 usv_info，回退 BaseDeviceStatus.position。"""
    try:
        pos = dds_object.position()
        lat = float(pos.latitude())
        lng = float(pos.longitude())
        alt = float(pos.altitude())
        usv_lat = lat
        usv_lon = lng
        usv_hdg = None
        usv_cog = None
        usv_sog = None
        if hasattr(dds_object, 'usv_info'):
            try:
                info = dds_object.usv_info()
                usv_lat = float(info.lat())
                usv_lon = float(info.lon())
                usv_hdg = float(info.HDG())
                usv_cog = float(info.COG())
                usv_sog = float(info.SOG())
            except Exception:
                pass
        result: Dict[str, Any] = {
            'entityId': dds_object.entityId(),
            'online': dds_object.online(),
            'timestamp': dds_object.timestamp(),
            'strikeState': int(dds_object.strikeState()),
            'latitude': usv_lat,
            'longitude': usv_lon,
            'altitude': alt,
            'usv_lat': usv_lat,
            'usv_lon': usv_lon,
            'source': 'DDS',
            'data_type': 'usv_status',
        }
        if usv_hdg is not None:
            result['usv_HDG'] = usv_hdg
        if usv_cog is not None:
            result['usv_COG'] = usv_cog
        if usv_sog is not None:
            result['usv_SOG'] = usv_sog
        if hasattr(dds_object, 'isVirtualWeapon'):
            result['isVirtualWeapon'] = bool(dds_object.isVirtualWeapon())
        if hasattr(dds_object, 'dispositionType'):
            result['dispositionType'] = int(dds_object.dispositionType())
        if hasattr(dds_object, 'entityType'):
            result['entityType'] = int(dds_object.entityType())
        if hasattr(dds_object, 'targetID'):
            result['targetID'] = dds_object.targetID()
        if hasattr(dds_object, 'targetName'):
            result['targetName'] = dds_object.targetName()
        if hasattr(dds_object, 'taskType'):
            result['taskType'] = dds_object.taskType()
        if hasattr(dds_object, 'executionState'):
            result['executionState'] = int(dds_object.executionState())
        if hasattr(dds_object, 'elec'):
            result['elec'] = float(dds_object.elec())
        if not (-90 <= float(usv_lat) <= 90) or not (-180 <= float(usv_lon) <= 180):
            return None
        return result
    except Exception as e:
        logger.error(f"解析无人船状态失败: {e}")
        return None


def _parse_munition_status(dds_object) -> Optional[Dict]:
    """MunitionRealTimeStatus（巡飞弹）；状态用 munitionState，不使用 BaseDeviceStatus.deviceState。"""
    try:
        pos = dds_object.position()
        result: Dict[str, Any] = {
            'entityId': dds_object.entityId(),
            'online': dds_object.online(),
            'timestamp': dds_object.timestamp(),
            'munitionState': int(dds_object.munitionState()),
            'hitPoint': float(dds_object.hitPoint()),
            'attitude_head': float(dds_object.attitude_head()),
            'latitude': float(pos.latitude()),
            'longitude': float(pos.longitude()),
            'altitude': float(pos.altitude()),
            'source': 'DDS',
            'data_type': 'munition_status',
        }
        if hasattr(dds_object, 'isVirtualWeapon'):
            result['isVirtualWeapon'] = bool(dds_object.isVirtualWeapon())
        if hasattr(dds_object, 'dispositionType'):
            result['dispositionType'] = int(dds_object.dispositionType())
        if hasattr(dds_object, 'entityType'):
            result['entityType'] = int(dds_object.entityType())
        if hasattr(dds_object, 'targetID'):
            result['targetID'] = dds_object.targetID()
        if hasattr(dds_object, 'targetName'):
            result['targetName'] = dds_object.targetName()
        lat = result.get('latitude')
        lng = result.get('longitude')
        if lat is None or lng is None or not (-90 <= float(lat) <= 90) or not (-180 <= float(lng) <= 180):
            return None
        return result
    except Exception as e:
        logger.error(f"解析巡飞弹状态失败: {e}")
        return None


def _parse_high_freq(dds_object) -> Optional[Dict]:
    """highFreqRealTimeStatus，对齐 build/test_highfreq.py"""
    return {
        'entityId': dds_object.entityId(),
        'online': dds_object.online(),
        'deviceState': _dds_device_state(dds_object),
        'timestamp': dds_object.timestamp(),
        'drone_sn': dds_object.drone_sn(),
        'dock_sn': dds_object.dock_sn(),
        'attitude_head': dds_object.attitude_head(),
        'latitude': dds_object.latitude(),
        'longitude': dds_object.longitude(),
        'height': dds_object.height(),
        'speed_x': dds_object.speed_x(),
        'speed_y': dds_object.speed_y(),
        'speed_z': dds_object.speed_z(),
        'gimbal_pitch': dds_object.gimbal_pitch(),
        'gimbal_roll': dds_object.gimbal_roll(),
        'gimbal_yaw': dds_object.gimbal_yaw(),
        'source': 'DDS',
        'data_type': 'high_freq',
        'isVirtualWeapon': bool(dds_object.isVirtualWeapon()) if hasattr(dds_object, 'isVirtualWeapon') else False,
    }


def _parse_camera_status(dds_object) -> Optional[Dict]:
    """CameraRealTimeStatus，对齐 build/test_camera.py"""
    pos = dds_object.position()
    ptz = dds_object.ptz()
    origin_ptz = dds_object.originPtz()
    fov = dds_object.fov()
    return {
        'entityId': dds_object.entityId(),
        'online': dds_object.online(),
        'deviceState': _dds_device_state(dds_object),
        'timestamp': dds_object.timestamp(),
        'taskType': dds_object.taskType(),
        'executionState': dds_object.executionState(),
        'executionTimeMs': dds_object.executionTimeMs(),
        'elec': dds_object.elec(),
        'focus': dds_object.focus(),
        'panoOffset': dds_object.panoOffset(),
        'trackID': dds_object.trackID(),
        'visibility': dds_object.visibility(),
        'speedParam': dds_object.speedParam(),
        'rootPos': dds_object.rootPos(),
        'ptz': {'pan': ptz.pan(), 'tilt': ptz.tilt(), 'zoom': ptz.zoom()},
        'originPtz': {
            'pan': origin_ptz.pan(),
            'tilt': origin_ptz.tilt(),
            'zoom': origin_ptz.zoom(),
        },
        'fov': {'horizontal': fov.hs(), 'vertical': fov.vs()},
        'position': {
            'longitude': pos.longitude(),
            'latitude': pos.latitude(),
            'altitude': pos.altitude(),
        },
        'source': 'DDS',
        'data_type': 'camera_status',
    }


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
