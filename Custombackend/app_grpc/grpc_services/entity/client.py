"""gRPC client replacing entity HTTP polling."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Any, Callable, Dict, Optional

import grpc
from google.protobuf.json_format import MessageToDict
from loguru import logger

from grpc_services.entity.proto_codegen import load_entity_proto_modules
from parsers.entity_parser import parse_entities_response, parse_relationships_response


def _lower_first(value: str) -> str:
    return value[:1].lower() + value[1:] if value else value


def _normalize_keys(value: Any) -> Any:
    if isinstance(value, list):
        return [_normalize_keys(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {_lower_first(key): _normalize_keys(item) for key, item in value.items()}


def _message_to_dict(message: Any, *, status_stream: bool = False) -> Dict[str, Any]:
    try:
        kwargs = {
            "preserving_proto_field_name": False,
        }
        if status_stream:
            kwargs["use_integers_for_enums"] = True
            kwargs["always_print_fields_with_no_presence"] = True
        else:
            kwargs["including_default_value_fields"] = True
        return MessageToDict(message, **kwargs)
    except TypeError:
        try:
            return MessageToDict(
                message,
                preserving_proto_field_name=False,
                use_integers_for_enums=status_stream,
            )
        except TypeError:
            return MessageToDict(message, preserving_proto_field_name=False)


def _enum_number(value: Any, mapping: Dict[str, int]) -> Any:
    if isinstance(value, str):
        return mapping.get(value, value)
    return value


def _first_present(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def _grpc_waypoints_to_dds_shape(points: Any) -> list[Dict[str, Any]]:
    if not isinstance(points, list):
        return []
    waypoints: list[Dict[str, Any]] = []
    for point in points:
        if not isinstance(point, dict):
            continue
        waypoints.append({
            "index": _to_int(point.get("index")),
            "latitude": point.get("latitude"),
            "longitude": point.get("longitude"),
            "height": point.get("height"),
            "speed": point.get("speed"),
        })
    return waypoints


def _grpc_munition_to_dds_shape(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        return {"munitionId": "", "name": "", "quantityUnits": None}
    return {
        "munitionId": value.get("munitionId") or "",
        "name": value.get("name") or "",
        "quantityUnits": value.get("quantityUnits"),
    }


def _to_int(value: Any) -> Any:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


def _disposition_name(value: Any) -> Optional[str]:
    # gRPC 阵营枚举：0=友方，1=敌方，2=中立；前端按字符串 disposition 上色。
    value = _to_int(value)
    if value == 0:
        return "friendly"
    if value == 1:
        return "hostile"
    if value == 2:
        return "neutral"
    return None


def _base_dds_fields(
    *,
    entity_id: str,
    base: Dict[str, Any],
    device_state: Any,
    execution_state: Any,
) -> Dict[str, Any]:
    return {
        "entityId": entity_id,
        "online": base.get("online"),
        "deviceState": device_state,
        "timestamp": base.get("timestamp"),
        "taskType": base.get("taskType"),
        "executionState": execution_state,
        "executionTimeMs": base.get("executionTimeMs"),
        "elec": base.get("elec"),
        "isVirtualWeapon": base.get("isVirtualWeapon"),
        "dispositionType": base.get("dispositionType"),
        "disposition": _disposition_name(base.get("dispositionType")),
        "entityType": base.get("entityType"),
        "targetID": base.get("targetId"),
        "targetName": base.get("targetName"),
        "targetType": base.get("targetType"),
    }


def _camera_status_to_dds_shape(raw: Dict[str, Any], base_fields: Dict[str, Any]) -> Dict[str, Any]:
    position = (raw.get("base") or {}).get("position") or {}
    return {
        **base_fields,
        "focus": raw.get("focus"),
        "panoOffset": raw.get("panoOffset"),
        "trackID": raw.get("trackId"),
        "visibility": raw.get("visibility"),
        "speedParam": raw.get("speedParam"),
        "rootPos": raw.get("rootPos"),
        "ptz": raw.get("ptz"),
        "originPtz": raw.get("originPtz"),
        "fov": raw.get("fov"),
        "position": position,
        "source": "gRPC",
        "data_type": "camera_status",
    }


def _radar_status_to_dds_shape(raw: Dict[str, Any], base_fields: Dict[str, Any]) -> Dict[str, Any]:
    return {
        **base_fields,
        "radarID": raw.get("radarId"),
        "radarType": raw.get("radarType"),
        "radarName": raw.get("radarName"),
        "longitude": raw.get("longitude"),
        "latitude": raw.get("latitude"),
        "transmit": raw.get("transmit"),
        "range": raw.get("range"),
        "pluseWidth": raw.get("pulseWidth"),
        "aziOffset": raw.get("aziOffset"),
        "rangeOffset": raw.get("rangeOffset"),
        "sampleRate": raw.get("sampleRate"),
        "gain": raw.get("gain"),
        "seaClutter": raw.get("seaClutter"),
        "rainClutter": raw.get("rainClutter"),
        "inhibit1": raw.get("inhibit1"),
        "inhibit1StartAzi": raw.get("inhibit1StartAzi"),
        "inhibit1EndAzi": raw.get("inhibit1EndAzi"),
        "inhibit2": raw.get("inhibit2"),
        "inhibit2StartAzi": raw.get("inhibit2StartAzi"),
        "inhibit2EndAzi": raw.get("inhibit2EndAzi"),
        "source": "gRPC",
        "data_type": "radar_status",
    }


def _dock_status_to_dds_shape(raw: Dict[str, Any], base_fields: Dict[str, Any]) -> Dict[str, Any]:
    return {
        **base_fields,
        "dock_sn": raw.get("dockSn"),
        "mode_code": raw.get("modeCode"),
        "flighttask_step_code": raw.get("flighttaskStepCode"),
        "cover_state": raw.get("coverState"),
        "drone_in_dock": raw.get("droneInDock"),
        "temperature": raw.get("temperature"),
        "environment_temperature": raw.get("environmentTemperature"),
        "humidity": raw.get("humidity"),
        "wind_speed": raw.get("windSpeed"),
        "working_voltage": raw.get("workingVoltage"),
        "working_current": raw.get("workingCurrent"),
        "alarm_state": raw.get("alarmState"),
        "latitude": raw.get("latitude"),
        "longitude": raw.get("longitude"),
        "height": raw.get("height"),
        "firmware_version": raw.get("firmwareVersion"),
        "job_number": raw.get("jobNumber"),
        "position_state": _dock_position_state_to_dds_shape(raw.get("positionState") or {}),
        "battery_capacity_percent": (raw.get("droneChargeState") or {}).get("capacityPercent")
        if isinstance(raw.get("droneChargeState"), dict)
        else None,
        "sub_device": _sub_device_to_dds_shape(raw.get("subDevice") or {}),
        "source": "gRPC",
        "data_type": "dock_status",
    }


def _drone_status_to_dds_shape(raw: Dict[str, Any], base_fields: Dict[str, Any]) -> Dict[str, Any]:
    battery = raw.get("battery") or {}
    return {
        **base_fields,
        "drone_sn": raw.get("droneSn"),
        "track_id": raw.get("trackId"),
        "mode_code": raw.get("modeCode"),
        "latitude": raw.get("latitude"),
        "longitude": raw.get("longitude"),
        "elevation": raw.get("elevation"),
        "height": raw.get("height"),
        "attitude_head": raw.get("attitudeHead"),
        "attitude_pitch": raw.get("attitudePitch"),
        "attitude_roll": raw.get("attitudeRoll"),
        "horizontal_speed": raw.get("horizontalSpeed"),
        "vertical_speed": raw.get("verticalSpeed"),
        "wind_speed": raw.get("windSpeed"),
        "home_distance": raw.get("homeDistance"),
        "home_latitude": raw.get("homeLatitude"),
        "home_longitude": raw.get("homeLongitude"),
        "control_source": raw.get("controlSource"),
        "gear": raw.get("gear"),
        "height_limit": raw.get("heightLimit"),
        "firmware_version": raw.get("firmwareVersion"),
        "battery_percent": battery.get("capacityPercent") if isinstance(battery, dict) else None,
        "position_state": _drone_position_state_to_dds_shape(raw.get("positionState") or {}),
        "obstacle_avoidance": _obstacle_avoidance_to_dds_shape(raw.get("obstacleAvoidance") or {}),
        "source": "gRPC",
        "data_type": "drone_status",
    }


def _drone_task_to_dds_shape(raw: Dict[str, Any], base_fields: Dict[str, Any]) -> Dict[str, Any]:
    current_wayline = raw.get("currentWayline") or {}
    return {
        **base_fields,
        "drone_state": raw.get("droneState"),
        "drone_task_action": raw.get("droneTaskAction"),
        "drone_task_targetID": raw.get("droneTaskTargetId"),
        "rev2": raw.get("droneTaskTargetId"),
        "current_wayline": {
            "wayline_id": current_wayline.get("waylineId"),
            "wayline_name": current_wayline.get("waylineName"),
            "template_type": current_wayline.get("templateType"),
            "auto_flight_speed": current_wayline.get("autoFlightSpeed"),
            "global_height": current_wayline.get("globalHeight"),
            "finish_action": current_wayline.get("finishAction"),
        },
        "waypoints": _grpc_waypoints_to_dds_shape(current_wayline.get("wayPointList") or []),
        "current_SearchArea": {"area_name": ((raw.get("currentSearchArea") or {}).get("areaName"))},
        "position": (raw.get("base") or {}).get("position") or {},
        "munition_info": _grpc_munition_to_dds_shape(raw.get("munitionInfo") or {}),
        "source": "gRPC",
        "data_type": "drone_task",
    }


def _high_freq_to_dds_shape(raw: Dict[str, Any], base_fields: Dict[str, Any]) -> Dict[str, Any]:
    return {
        **base_fields,
        "drone_sn": raw.get("droneSn"),
        "dock_sn": raw.get("dockSn"),
        "attitude_head": raw.get("attitudeHead"),
        "latitude": raw.get("latitude"),
        "longitude": raw.get("longitude"),
        "height": raw.get("height"),
        "speed_x": raw.get("speedX"),
        "speed_y": raw.get("speedY"),
        "speed_z": raw.get("speedZ"),
        "gimbal_pitch": raw.get("gimbalPitch"),
        "gimbal_roll": raw.get("gimbalRoll"),
        "gimbal_yaw": raw.get("gimbalYaw"),
        "source": "gRPC",
        "data_type": "high_freq",
    }


def _usv_status_to_dds_shape(raw: Dict[str, Any], base_fields: Dict[str, Any]) -> Dict[str, Any]:
    position = (raw.get("base") or {}).get("position") or {}
    usv_info = raw.get("usvInfo") or {}
    lat = _first_present(usv_info.get("latitude"), position.get("latitude"))
    lng = _first_present(usv_info.get("longitude"), position.get("longitude"))
    body = {
        **base_fields,
        "strikeState": raw.get("strikeState"),
        "latitude": lat,
        "longitude": lng,
        "altitude": position.get("altitude"),
        "usv_lat": lat,
        "usv_lon": lng,
        "source": "gRPC",
        "data_type": "usv_status",
    }
    if usv_info.get("hdg") is not None:
        body["usv_HDG"] = usv_info.get("hdg")
    if usv_info.get("cog") is not None:
        body["usv_COG"] = usv_info.get("cog")
    if usv_info.get("sog") is not None:
        body["usv_SOG"] = usv_info.get("sog")
    return body


def _directed_weapon_to_dds_shape(
    raw: Dict[str, Any],
    base_fields: Dict[str, Any],
    *,
    data_type: str,
    state_field: str,
    raw_state_field: str,
) -> Dict[str, Any]:
    position = (raw.get("base") or {}).get("position") or {}
    return {
        **base_fields,
        state_field: raw.get(raw_state_field),
        "hitPoint": raw.get("hitPoint"),
        "latitude": position.get("latitude"),
        "longitude": position.get("longitude"),
        "altitude": position.get("altitude"),
        "source": "gRPC",
        "data_type": data_type,
    }


def _munition_status_to_dds_shape(raw: Dict[str, Any], base_fields: Dict[str, Any]) -> Dict[str, Any]:
    position = (raw.get("base") or {}).get("position") or {}
    alt = _first_present(raw.get("height"), position.get("altitude"))
    return {
        **base_fields,
        "munitionState": raw.get("munitionState"),
        "hitPoint": raw.get("hitPoint"),
        "attitude_head": raw.get("attitudeHead"),
        "latitude": _first_present(raw.get("latitude"), position.get("latitude")),
        "longitude": _first_present(raw.get("longitude"), position.get("longitude")),
        "height": alt,
        "altitude": alt,
        "position": position,
        "source": "gRPC",
        "data_type": "munition_status",
    }


def _dock_position_state_to_dds_shape(value: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "is_calibration": value.get("isCalibration"),
        "is_fixed": value.get("isFixed"),
        "quality": value.get("quality"),
        "gps_number": value.get("gpsNumber"),
        "rtk_number": value.get("rtkNumber"),
    }


def _drone_position_state_to_dds_shape(value: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "is_fixed": value.get("isFixed"),
        "quality": value.get("quality"),
        "gps_number": value.get("gpsNumber"),
        "rtk_number": value.get("rtkNumber"),
    }


def _obstacle_avoidance_to_dds_shape(value: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "horizon": value.get("horizon"),
        "upside": value.get("upside"),
        "downside": value.get("downside"),
    }


def _sub_device_to_dds_shape(value: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "device_sn": value.get("deviceSn"),
        "device_online_status": value.get("deviceOnlineStatus"),
        "device_paired": value.get("devicePaired"),
    }


def _flatten_entity_message(entity_message: Any) -> Dict[str, Any]:
    oneof_name = entity_message.WhichOneof("entity")
    if not oneof_name:
        return {}
    payload = getattr(entity_message, oneof_name)
    return _normalize_keys(_message_to_dict(payload))


def _log_parsed_radar_entities(client_id: str, entities_result: Dict[str, Any]) -> None:
    entities = (entities_result or {}).get("entities") or []
    radars = [
        entity for entity in entities
        if isinstance(entity, dict) and str(entity.get("assetType") or "").lower() == "radar"
    ]
    if not radars:
        logger.info("[entity-grpc] parsed radar entities from grpc response | id={} count=0", client_id)
        return
    samples = []
    for entity in radars:
        samples.append({
            "entityId": entity.get("entityId"),
            "name": entity.get("name"),
            "assetType": entity.get("assetType"),
            "specificType": entity.get("specificType"),
            "platformType": entity.get("platformType"),
            "lat": entity.get("lat"),
            "lng": entity.get("lng"),
            "altitude": entity.get("altitude"),
            "online": entity.get("online"),
            "deviceState": entity.get("deviceState"),
            "radarParameters": entity.get("radarParameters"),
        })
    # logger.warning(
    #     "[entity-grpc] parsed radar entities from grpc response | id={} count={} radars={}",
    #     client_id,
    #     len(radars),
    #     samples,
    # )


class EntityGrpcClient:
    def __init__(
        self,
        config: Dict[str, Any],
        entities_callback: Callable[[Dict[str, Any], str], None],
        relationships_callback: Callable[[Dict[str, Any], str], None],
        status_callback: Callable[[Dict[str, Any], str], None],
    ) -> None:
        self.id = config.get("id", "entity_grpc")
        self.name = config.get("name", "entity gRPC")
        self.host = config.get("host") or config.get("grpc_host") or "127.0.0.1"
        self.port = int(config.get("port") or config.get("grpc_port") or 60053)
        self.poll_interval = float(config.get("poll_interval", 5.0))
        self.page = int(config.get("page", 1))
        self.size = int(config.get("size", 1000))
        self.entity_template = str(config.get("entity_template", ""))
        self.entity_type = str(config.get("entity_type", ""))
        self.timeout = float(config.get("timeout", 10.0))
        self.enable_status_stream = bool(config.get("enable_status_stream", True))
        self.enable_entity_query = bool(config.get("enable_entity_query", True))
        self.query_entities_method = str(config.get("query_entities_method") or "MultiQueryEntity")
        self.query_relationships_method = str(config.get("query_relationships_method") or "GetEntityRelationship")
        self.status_stream_method = str(config.get("status_stream_method") or "EntityStatusMethod")
        self.allowed_status_fields = self._parse_allowed_status_fields(config.get("allowed_status_fields"))
        self._status_stream_unsupported = False

        self._entities_callback = entities_callback
        self._relationships_callback = relationships_callback
        self._status_callback = status_callback
        self._running = False
        self._query_task: Optional[asyncio.Task] = None
        self._status_task: Optional[asyncio.Task] = None
        self._channel: Optional[grpc.aio.Channel] = None

        self._status_pb2 = None
        self._status_pb2_grpc = None
        self._entity_pb2 = None
        self._entity_pb2_grpc = None
        self._entity_stub = None
        self._status_stub = None

    @property
    def target(self) -> str:
        return f"{self.host}:{self.port}"

    @staticmethod
    def _parse_allowed_status_fields(value: Any) -> Optional[set[str]]:
        if value is None:
            return None
        if isinstance(value, str):
            items = [item.strip() for item in value.split(",")]
        elif isinstance(value, (list, tuple, set)):
            items = [str(item).strip() for item in value]
        else:
            items = []
        fields = {item for item in items if item}
        return fields or None

    async def start(self) -> None:
        if self._running:
            return
        self._status_pb2, self._status_pb2_grpc, self._entity_pb2, self._entity_pb2_grpc = load_entity_proto_modules()
        self._channel = grpc.aio.insecure_channel(self.target)
        self._entity_stub = self._entity_pb2_grpc.EntityServiceStub(self._channel)
        self._status_stub = self._status_pb2_grpc.EntityStatusServiceStub(self._channel)
        self._running = True
        if self.enable_entity_query:
            self._query_task = asyncio.create_task(self._query_loop())
        if self.enable_status_stream:
            self._status_task = asyncio.create_task(self._status_stream_loop())
        logger.info(
            "[entity-grpc] started | id={} target={} query={} status_stream={} poll_interval={}s",
            self.id,
            self.target,
            self.enable_entity_query,
            self.enable_status_stream,
            self.poll_interval,
        )

    async def stop(self) -> None:
        self._running = False
        for task in (self._query_task, self._status_task):
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        self._query_task = None
        self._status_task = None
        if self._channel:
            await self._channel.close()
            self._channel = None
        logger.info("[entity-grpc] stopped | id={}", self.id)

    async def _query_loop(self) -> None:
        while self._running:
            try:
                await self._query_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("[entity-grpc] query failed | id={} error={}", self.id, exc)
            await asyncio.sleep(self.poll_interval)

    async def _query_once(self) -> None:
        if not self._entity_stub:
            return

        req = self._entity_pb2.MultiQueryEntityRequest(
            entityTemplate=self.entity_template,
            entityType=self.entity_type,
            page=self.page,
            size=self.size,
        )
        query_entities = getattr(self._entity_stub, self.query_entities_method)
        resp = await query_entities(req, timeout=self.timeout)
        records = [_flatten_entity_message(item) for item in resp.entities]
        payload = {
            "code": int(resp.code),
            "message": resp.message,
            "data": {
                "records": records,
                "total": len(records),
                "current": self.page,
                "pages": 1,
            },
        }
        entities_result = parse_entities_response(payload)
        if entities_result is not None:
            _log_parsed_radar_entities(self.id, entities_result)
            self._entities_callback(entities_result, self.id)

        query_relationships = getattr(self._entity_stub, self.query_relationships_method)
        rel_resp = await query_relationships(
            self._entity_pb2.GetEntityRelationshipRequest(),
            timeout=self.timeout,
        )
        rel_payload = self._parse_relationship_payload(rel_resp)
        self._relationships_callback(rel_payload, self.id)

    def _parse_relationship_payload(self, response: Any) -> Dict[str, Any]:
        data = response.data or ""
        parsed: Any = None
        if data:
            try:
                parsed = json.loads(data)
            except json.JSONDecodeError:
                logger.warning("[entity-grpc] relationship data is not json | message={}", response.message)
        if isinstance(parsed, dict):
            if "code" not in parsed:
                parsed = {"code": int(response.code), "message": response.message, "data": parsed}
            return parsed
        if isinstance(parsed, list):
            return {"code": int(response.code), "message": response.message, "data": {"records": parsed}}
        return {"code": int(response.code), "message": response.message, "data": {"records": []}}

    async def _status_stream_loop(self) -> None:
        while self._running:
            if self._status_stream_unsupported:
                return
            try:
                request = self._status_pb2.EntityStatusRequest()
                status_stream = getattr(self._status_stub, self.status_stream_method)
                async for response in status_stream(request):
                    status = self._status_response_to_patch(response)
                    if status:
                        self._status_callback(status, self.id)
                    if not self._running:
                        break
            except asyncio.CancelledError:
                raise
            except grpc.aio.AioRpcError as exc:
                if exc.code() == grpc.StatusCode.UNIMPLEMENTED:
                    self._status_stream_unsupported = True
                    logger.warning(
                        "[entity-grpc] status stream unsupported by server, disabled | id={} target={} method={}",
                        self.id,
                        self.target,
                        self.status_stream_method,
                    )
                    return
                logger.warning("[entity-grpc] status stream disconnected | id={} error={}", self.id, exc)
                await asyncio.sleep(2.0)
            except Exception as exc:
                logger.warning("[entity-grpc] status stream disconnected | id={} error={}", self.id, exc)
                await asyncio.sleep(2.0)

    def _status_response_to_patch(self, response: Any) -> Optional[Dict[str, Any]]:
        field = response.WhichOneof("status")
        if not field:
            return None
        if self.allowed_status_fields is not None and field not in self.allowed_status_fields:
            return None
        message = getattr(response, field)
        raw = _normalize_keys(_message_to_dict(message, status_stream=True))
        base = raw.get("base") or {}
        entity_id = str(base.get("entityId") or "").strip()
        # if(field == "high_freq_real_time_status"):
            # print("_status_response_to_patch:",response)
        if not entity_id:
            return None
        position = base.get("position") or {}
        device_state = _enum_number(base.get("deviceState"), {
            "DEVICE_STATE_STANDBY": 0,
            "DEVICE_STATE_POWERED": 1,
            "DEVICE_STATE_EXECUTING": 2,
            "DEVICE_STATE_UNKNOWN": 3,
        })
        execution_state = _enum_number(base.get("executionState"), {
            "EXECUTING": 0,
            "COMPLETED": 1,
            "ALREADY_CLEARED": 2,
            "SAVED": 3,
            "FAILED": 4,
        })
        patch = {
            "entityId": entity_id,
            "status": {
                "platformActivity": base.get("taskType"),
                "deviceState": device_state,
                "executionState": execution_state,
            },
            "deviceState": device_state,
            "platformActivity": base.get("taskType"),
            "taskType": base.get("taskType"),
            "executionState": execution_state,
            "executionTimeMs": base.get("executionTimeMs"),
            "online": base.get("online"),
            "lat": _first_present(position.get("latitude"), raw.get("latitude")),
            "lng": _first_present(position.get("longitude"), raw.get("longitude")),
            "altitude": _first_present(position.get("altitude"), raw.get("height")),
            "heading": _first_present(raw.get("attitudeHead"), raw.get("heading")),
            "batteryPercent": base.get("elec"),
            "elec": base.get("elec"),
            "timestamp": base.get("timestamp") or datetime.now().isoformat(),
            "_grpcStatusType": field,
            "_grpcStatusRaw": raw,
        }
        base_fields = _base_dds_fields(
            entity_id=entity_id,
            base=base,
            device_state=device_state,
            execution_state=execution_state,
        )
        if field == "camera_real_time_status":
            patch.update({"assetType": "camera", **_camera_status_to_dds_shape(raw, base_fields)})
        elif field == "radar_real_time_status":
            patch.update({"assetType": "radar", **_radar_status_to_dds_shape(raw, base_fields)})
        elif field == "dock_real_time_status":
            patch.update({"assetType": "airport", **_dock_status_to_dds_shape(raw, base_fields)})
        elif field == "drone_real_time_status":
            drone_patch = _drone_status_to_dds_shape(raw, base_fields)
            patch.update({
                "assetType": "drone",
                **drone_patch,
                "lat": _first_present(drone_patch.get("latitude"), patch.get("lat")),
                "lng": _first_present(drone_patch.get("longitude"), patch.get("lng")),
                "altitude": _first_present(drone_patch.get("height"), patch.get("altitude")),
                "heading": _first_present(drone_patch.get("attitude_head"), patch.get("heading")),
                "deviceSn": drone_patch.get("drone_sn"),
                "trackId": drone_patch.get("track_id"),
            })
            print("==================drone_real_time_status",entity_id,patch["lat"],patch["lng"])
        elif field == "drone_task_real_time_status":
            # print("==================drone_task_real_time_status",entity_id)
            patch.update({"assetType": "drone", **_drone_task_to_dds_shape(raw, base_fields)})
        elif field == "high_freq_real_time_status":
            high_freq_patch = _high_freq_to_dds_shape(raw, base_fields)
            patch.update({
                "assetType": "drone",
                **high_freq_patch,
                "lat": _first_present(high_freq_patch.get("latitude"), patch.get("lat")),
                "lng": _first_present(high_freq_patch.get("longitude"), patch.get("lng")),
                "altitude": _first_present(high_freq_patch.get("height"), patch.get("altitude")),
                "heading": _first_present(high_freq_patch.get("attitude_head"), patch.get("heading")),
                "deviceSn": high_freq_patch.get("drone_sn"),
            })
            print("==================high_freq_real_time_status",entity_id,patch["lat"],patch["lng"])
        elif field == "usv_real_time_status":
            usv_patch = _usv_status_to_dds_shape(raw, base_fields)
            patch.update({
                "assetType": "usv",
                **usv_patch,
                "lat": _first_present(usv_patch.get("latitude"), patch.get("lat")),
                "lng": _first_present(usv_patch.get("longitude"), patch.get("lng")),
                "altitude": _first_present(usv_patch.get("altitude"), patch.get("altitude")),
            })
        elif field == "laser_real_time_status":
            patch.update({
                "assetType": "laser",
                **_directed_weapon_to_dds_shape(
                    raw,
                    base_fields,
                    data_type="laser_status",
                    state_field="laserState",
                    raw_state_field="laserState",
                ),
            })
        elif field == "jammer_real_time_status":
            patch.update({
                "assetType": "jammer",
                **_directed_weapon_to_dds_shape(
                    raw,
                    base_fields,
                    data_type="tdoa_status",
                    state_field="tdoaState",
                    raw_state_field="jammerState",
                ),
            })
        elif field == "munition_real_time_status":
            munition_patch = _munition_status_to_dds_shape(raw, base_fields)
            patch.update({
                "assetType": "missile",
                **munition_patch,
                "lat": _first_present(munition_patch.get("latitude"), patch.get("lat")),
                "lng": _first_present(munition_patch.get("longitude"), patch.get("lng")),
                "altitude": _first_present(munition_patch.get("altitude"), patch.get("altitude")),
            })
        return patch
