#!/usr/bin/env python3
"""
entity/200 相机 PTZ 订阅测试（与 camServer + Custombackend dds_camera_status 对齐）

  Topic  : CameraRealTimeStatusTopic
  Type   : casia::device::status::CameraStatus::CameraRealTimeStatus
  Domain : 200
  XML    : camera_status_subscriber.xml (profile camera_status_subscriber)
  DS     : 192.168.18.141:11611

用法（须在 xk_docker 或已配置 fastdds Python 绑定的环境）:
    python3 test_entity200_camera.py
    python3 test_entity200_camera.py --seconds 30
"""
import argparse
import ctypes
import os
import signal
import sys
import time
from datetime import datetime

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

_lib = os.path.join(_THIS_DIR, "libEntityRealTimeStatus.so")
if os.path.exists(_lib):
    try:
        ctypes.CDLL(_lib)
    except OSError as e:
        print(f"[warn] preload libEntityRealTimeStatus.so: {e}")

try:
    import fastdds
except ImportError as e:
    print(f"[error] import fastdds failed: {e}")
    print("请在 xk_docker 内运行，或设置 PYTHONPATH/LD_LIBRARY_PATH（见 NexusUI/docker/start.sh）")
    sys.exit(1)

try:
    from EntityRealTimeStatus import CameraRealTimeStatus, CameraRealTimeStatusPubSubType
except ImportError as e:
    print(f"[error] import EntityRealTimeStatus failed: {e}")
    sys.exit(1)

try:
    _OK = fastdds.ReturnCode_t.RETCODE_OK
except AttributeError:
    _OK = 0

DDS_TYPE_NAME = "casia::device::status::CameraStatus::CameraRealTimeStatus"
PROFILE_NAME = "camera_status_subscriber"
DEFAULT_XML = os.path.join(_THIS_DIR, "camera_status_subscriber.xml")


class Listener(fastdds.DataReaderListener):
    def __init__(self):
        super().__init__()
        self.recv_count = 0
        self.matched_count = 0
        self.last_sample = None

    def on_subscription_matched(self, datareader, info):
        self.matched_count = info.current_count
        if info.current_count_change > 0:
            print(f"[match] publisher matched, total={info.current_count}")
        elif info.current_count_change < 0:
            print(f"[unmatch] publisher unmatched, total={info.current_count}")

    def on_data_available(self, reader):
        info = fastdds.SampleInfo()
        data = CameraRealTimeStatus()
        while reader.take_next_sample(data, info) == _OK:
            if not info.valid_data:
                continue
            self.recv_count += 1
            try:
                ptz = data.ptz()
                pos = data.position()
                self.last_sample = {
                    "entityId": data.entityId(),
                    "pan": ptz.pan(),
                    "tilt": ptz.tilt(),
                    "zoom": ptz.zoom(),
                    "lon": pos.longitude(),
                    "lat": pos.latitude(),
                    "visibility": data.visibility(),
                }
            except Exception:
                self.last_sample = {"entityId": getattr(data, "entityId", lambda: "?")()}
            if self.recv_count <= 3 or self.recv_count % 50 == 0:
                s = self.last_sample
                print(
                    f"[data #{self.recv_count}] entity={s.get('entityId')} "
                    f"pan={s.get('pan')} tilt={s.get('tilt')} zoom={s.get('zoom')} "
                    f"vis={s.get('visibility')}"
                )


def run_test(topic: str, domain: int, xml_path: str, seconds: float) -> int:
    factory = fastdds.DomainParticipantFactory.get_instance()
    if xml_path:
        ret = factory.load_XML_profiles_file(xml_path)
        rc_ok = getattr(getattr(fastdds, "ReturnCode_t", None), "RETCODE_OK", None)
        if rc_ok is not None and ret not in (rc_ok, 0):
            print(f"[error] load XML failed: {ret} path={xml_path}")
            return 2
        print(f"[init] XML={xml_path}")

    participant = None
    if xml_path and hasattr(factory, "create_participant_with_profile"):
        try:
            participant = factory.create_participant_with_profile(domain, PROFILE_NAME)
        except Exception:
            try:
                participant = factory.create_participant_with_profile(PROFILE_NAME)
            except Exception:
                participant = None
    if participant is None:
        pqos = fastdds.DomainParticipantQos()
        if xml_path and hasattr(factory, "get_participant_qos_from_profile"):
            factory.get_participant_qos_from_profile(PROFILE_NAME, pqos)
        else:
            factory.get_default_participant_qos(pqos)
        participant = factory.create_participant(domain, pqos)

    if participant is None:
        print(f"[error] create participant failed domain={domain}")
        return 2

    pubsub_type = CameraRealTimeStatusPubSubType()
    if hasattr(pubsub_type, "set_name"):
        pubsub_type.set_name(DDS_TYPE_NAME)
    else:
        pubsub_type.setName(DDS_TYPE_NAME)
    participant.register_type(fastdds.TypeSupport(pubsub_type))

    topic_qos = fastdds.TopicQos()
    participant.get_default_topic_qos(topic_qos)
    topic_obj = participant.create_topic(topic, DDS_TYPE_NAME, topic_qos)
    if topic_obj is None:
        print(f"[error] create topic failed: {topic}")
        return 2

    sub_qos = fastdds.SubscriberQos()
    participant.get_default_subscriber_qos(sub_qos)
    subscriber = participant.create_subscriber(sub_qos)

    listener = Listener()
    reader_qos = fastdds.DataReaderQos()
    subscriber.get_default_datareader_qos(reader_qos)
    reader_qos.reliability().kind = fastdds.RELIABLE_RELIABILITY_QOS
    reader_qos.durability().kind = fastdds.TRANSIENT_LOCAL_DURABILITY_QOS
    reader = subscriber.create_datareader(topic_obj, reader_qos, listener)
    if reader is None:
        print("[error] create datareader failed")
        return 2

    print(
        f"[ready] topic={topic} domain={domain} type={DDS_TYPE_NAME}\n"
        f"        wait up to {seconds:.0f}s for match + samples..."
    )

    stop = [False]

    def _sig(_s, _f):
        stop[0] = True

    signal.signal(signal.SIGINT, _sig)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _sig)

    t0 = time.monotonic()
    while not stop[0] and (time.monotonic() - t0) < seconds:
        time.sleep(0.5)

    participant.delete_contained_entities()
    factory.delete_participant(participant)

    elapsed = time.monotonic() - t0
    print(
        f"\n=== result ({elapsed:.1f}s) ===\n"
        f"  matched_publishers : {listener.matched_count}\n"
        f"  received_samples   : {listener.recv_count}\n"
        f"  last_sample        : {listener.last_sample}\n"
    )
    if listener.recv_count > 0:
        print("PASS: entity/200 能收到 Camera PTZ 数据")
        return 0
    if listener.matched_count > 0:
        print("WARN: 已 matched 但 0 条数据（发布端可能未 write 或 QoS 不匹配）")
        return 1
    print("FAIL: 未 matched，entity/200 订阅不通（Topic/Type/Discovery 不一致或发布端未起）")
    return 1


def main():
    ap = argparse.ArgumentParser(description="entity/200 CameraRealTimeStatus 订阅测试")
    ap.add_argument("--topic", default="CameraRealTimeStatusTopic")
    ap.add_argument("--domain", type=int, default=200)
    ap.add_argument("--xml", default=DEFAULT_XML)
    ap.add_argument("--seconds", type=float, default=35.0)
    args = ap.parse_args()
    xml = args.xml if args.xml and os.path.exists(args.xml) else ""
    if not xml:
        print(f"[warn] XML not found: {args.xml}, use default discovery")
    print(f"[start] {datetime.now().isoformat(timespec='seconds')}")
    sys.exit(run_test(args.topic, args.domain, xml, args.seconds))


if __name__ == "__main__":
    main()
