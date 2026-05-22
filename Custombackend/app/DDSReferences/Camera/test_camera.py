#!/usr/bin/env python3
"""
【相机状态】测试订阅脚本（须与发布端 Topic / Domain / 类型名完全一致）

  Topic  : CameraRealTimeStatusTopic（与 Custombackend config 一致；勿用 CameraRealTimeTopic）
  Type   : casia::device::status::CameraStatus::CameraRealTimeStatus（新 IDL；勿用裸名 CameraRealTimeStatus）
  Domain : 200（与后端 dds_camera_status 一致）
  Module : 同目录 EntityRealTimeStatus.py + _EntityRealTimeStatusWrapper.so + libEntityRealTimeStatus.so
  环境   : 须能 import fastdds，且 LD_LIBRARY_PATH 含与绑定匹配的 libfastdds（如 xk_docker 内 /usr/local/eprosima/fastdds/lib）

用法：
    python3 test_camera.py
    python3 test_camera.py --topic CameraRealTimeStatusTopic --domain 200
    python3 test_camera.py --ds-ip 192.168.18.141 --ds-port 11611
    python3 test_camera.py --no-xml
"""
import sys, os, time, signal, argparse
from datetime import datetime

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

import ctypes
_so = os.path.join(_THIS_DIR, "libEntityRealTimeStatus.so")
if os.path.exists(_so):
    try: ctypes.CDLL(_so)
    except Exception as e: print(f"[警告] 预加载 libEntityRealTimeStatus.so 失败: {e}")

try:
    import fastdds
except ImportError as e:
    print(f"[错误] 无法导入 fastdds: {e}"); sys.exit(1)

try:
    import EntityRealTimeStatus
    from EntityRealTimeStatus import CameraRealTimeStatus, CameraRealTimeStatusPubSubType
except ImportError as e:
    print(f"[错误] 无法导入 EntityRealTimeStatus: {e}")
    print(f"请确认 {_THIS_DIR} 中存在 EntityRealTimeStatus.py 和 _EntityRealTimeStatusWrapper.so")
    sys.exit(1)

try:    _OK = fastdds.ReturnCode_t.RETCODE_OK
except: _OK = 0

# 须与发布端 register_type / Topic 使用的名称一致（新 EntityRealTimeStatus.idl 下的全名）
DDS_TYPE_NAME = "casia::device::status::CameraStatus::CameraRealTimeStatus"

# ─────────────────────────────────────────────────────────────────────────────

class CameraReaderListener(fastdds.DataReaderListener):
    def __init__(self):
        super().__init__()
        self.recv_count = 0

    def on_subscription_matched(self, datareader, info):
        if info.current_count_change > 0:
            print(f"[匹配] 与发布者匹配成功 (+{info.current_count_change})")
        else:
            print(f"[断开] 发布者断开连接 ({info.current_count_change})")

    def on_data_available(self, reader):
        info = fastdds.SampleInfo()
        data = CameraRealTimeStatus()
        ret = reader.take_next_sample(data, info)
        if ret != _OK and ret != 0:
            return

        self.recv_count += 1
        ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]

        try:
            pos = data.position()
            pos_info = f"lon={pos.longitude():.6f}  lat={pos.latitude():.6f}  alt={pos.altitude():.2f} m"
        except: pos_info = "N/A"

        try:
            ptz = data.ptz()
            ptz_info = f"pan={ptz.pan():.4f}°  tilt={ptz.tilt():.4f}°  zoom={ptz.zoom():.4f}x"
        except: ptz_info = "N/A"

        try:
            op = data.originPtz()
            optz_info = f"pan={op.pan():.4f}°  tilt={op.tilt():.4f}°  zoom={op.zoom():.4f}x"
        except: optz_info = "N/A"

        try:
            fov = data.fov()
            fov_info = f"hs={fov.hs():.4f}°  vs={fov.vs():.4f}°"
        except: fov_info = "N/A"

        try:    sp = f"\n  speedParam   : {data.speedParam():.4f}"
        except: sp = ""
        try:    rp = f"\n  rootPos      : {data.rootPos():.4f}"
        except: rp = ""

        print(
            f"\n{'='*60}\n"
            f"[{ts}] 第 {self.recv_count} 条  CameraRealTimeStatus\n"
            f"{'='*60}\n"
            f"  entityId     : {data.entityId()}\n"
            f"  online       : {data.online()}\n"
            f"  timestamp    : {data.timestamp()}\n"
            f"  position     : {pos_info}\n"
            f"  ptz          : {ptz_info}\n"
            f"  originPtz    : {optz_info}\n"
            f"  fov          : {fov_info}\n"
            f"  focus        : {data.focus():.4f}\n"
            f"  panoOffset   : {data.panoOffset():.4f}°\n"
            f"  trackID      : {data.trackID()}\n"
            f"  visibility   : {data.visibility():.4f}"
            f"{sp}{rp}"
        )


class CameraSubscriber:
    def __init__(self, topic_name: str, domain_id: int, xml_path: str = ""):
        self.topic_name = topic_name
        self.domain_id = domain_id

        factory = fastdds.DomainParticipantFactory.get_instance()

        if xml_path:
            ret = factory.load_XML_profiles_file(xml_path)
            rc_ok = getattr(getattr(fastdds, "ReturnCode_t", None), "RETCODE_OK", None)
            if rc_ok is not None and ret != rc_ok and ret != 0:
                raise RuntimeError(f"load_XML_profiles_file 失败: {ret}, 文件={xml_path}")
            print(f"[XML] 已加载 profiles: {xml_path}")

            self.participant = None
            if hasattr(factory, "create_participant_with_profile"):
                try:
                    self.participant = factory.create_participant_with_profile(
                        domain_id, "camera_subscriber_client")
                except Exception:
                    try:
                        self.participant = factory.create_participant_with_profile(
                            "camera_subscriber_client")
                    except Exception:
                        pass
            if self.participant is None:
                pqos = fastdds.DomainParticipantQos()
                if hasattr(factory, "get_participant_qos_from_profile"):
                    factory.get_participant_qos_from_profile("camera_subscriber_client", pqos)
                self.participant = factory.create_participant(domain_id, pqos)
        else:
            pqos = fastdds.DomainParticipantQos()
            factory.get_default_participant_qos(pqos)
            self.participant = factory.create_participant(domain_id, pqos)

        if self.participant is None:
            raise RuntimeError(f"创建 DomainParticipant 失败 (domain={domain_id})")

        pubsub_type = CameraRealTimeStatusPubSubType()
        # Fast DDS 3.x 常用 set_name；若你环境只有旧 API 可改回 setName
        if hasattr(pubsub_type, "set_name"):
            pubsub_type.set_name(DDS_TYPE_NAME)
        else:
            pubsub_type.setName(DDS_TYPE_NAME)
        type_support = fastdds.TypeSupport(pubsub_type)
        self.participant.register_type(type_support)

        topic_qos = fastdds.TopicQos()
        self.participant.get_default_topic_qos(topic_qos)
        self.topic = self.participant.create_topic(topic_name, DDS_TYPE_NAME, topic_qos)
        if self.topic is None:
            raise RuntimeError(f"创建 Topic 失败 (topic={topic_name})")

        subscriber_qos = fastdds.SubscriberQos()
        self.participant.get_default_subscriber_qos(subscriber_qos)
        self.subscriber = self.participant.create_subscriber(subscriber_qos)

        self.listener = CameraReaderListener()
        reader_qos = fastdds.DataReaderQos()
        self.subscriber.get_default_datareader_qos(reader_qos)
        reader_qos.reliability().kind = fastdds.RELIABLE_RELIABILITY_QOS
        reader_qos.durability().kind  = fastdds.TRANSIENT_LOCAL_DURABILITY_QOS
        self.reader = self.subscriber.create_datareader(self.topic, reader_qos, self.listener)
        if self.reader is None:
            raise RuntimeError("创建 DataReader 失败")

        disc = f"{xml_path} (discovery server CLIENT)" if xml_path else "默认发现（组播）"
        print(
            f"\n[订阅器就绪]\n"
            f"  Topic    : {topic_name}\n"
            f"  Type     : {DDS_TYPE_NAME}\n"
            f"  Domain   : {domain_id}\n"
            f"  发现模式 : {disc}\n"
            f"  等待发布端... (Ctrl+C 退出)\n"
            f"  ⚠ 若长时间无「[匹配]」输出，说明 Topic/Type/Domain 与发布端不一致\n"
            f"  ⚠ 请试: --no-xml  或换其他 discovery server IP\n"
        )

    def delete(self):
        self.participant.delete_contained_entities()
        fastdds.DomainParticipantFactory.get_instance().delete_participant(self.participant)

    def run(self, max_seconds: float = 0.0):
        _stop = [False]
        def _sig(sig, frame):
            _stop[0] = True
        signal.signal(signal.SIGINT, _sig)
        if hasattr(signal, "SIGTERM"):
            signal.signal(signal.SIGTERM, _sig)
        t0 = time.monotonic()
        while not _stop[0]:
            if max_seconds > 0 and (time.monotonic() - t0) >= max_seconds:
                break
            time.sleep(0.5)
        self.delete()
        print(f"\n[结束] 共收到 {self.listener.recv_count} 条消息。")


_DEFAULT_XML = os.path.join(_THIS_DIR, "test_camera.xml")


def _write_xml(path, ds_ip, ds_port):
    with open(path, "w") as f:
        f.write(f"""<?xml version="1.0" encoding="UTF-8"?>
<dds xmlns="http://www.eprosima.com/XMLSchemas/fastRTPS_Profiles">
    <profiles>
        <participant profile_name="camera_subscriber_client">
            <rtps>
                <builtin>
                    <discovery_config>
                        <discoveryProtocol>CLIENT</discoveryProtocol>
                        <discoveryServersList>
                            <locator><udpv4>
                                <address>{ds_ip}</address>
                                <port>{ds_port}</port>
                            </udpv4></locator>
                        </discoveryServersList>
                    </discovery_config>
                </builtin>
                <defaultMulticastLocatorList>
                    <locator><udpv4>
                        <address>239.255.0.1</address><port>12359</port>
                    </udpv4></locator>
                </defaultMulticastLocatorList>
            </rtps>
        </participant>
    </profiles>
</dds>""")


def main():
    ap = argparse.ArgumentParser(
        description="CameraRealTimeStatus DDS 测试订阅器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("topic_name", nargs="?", default="CameraRealTimeStatusTopic",
                    help="订阅的 DDS Topic（默认: CameraRealTimeStatusTopic，与后端一致）")
    ap.add_argument("domain_id", nargs="?", type=int, default=200,
                    help="DDS Domain ID（默认: 200，与后端 dds_camera_status 一致）")
    ap.add_argument("--topic",   default=None,
                    help="等同于位置参数 topic_name")
    ap.add_argument("--ds-ip",   default="192.168.18.141")
    ap.add_argument("--ds-port", type=int, default=11611)
    ap.add_argument("--domain",  type=int, default=None)
    ap.add_argument("--xml",     default=None, metavar="FILE")
    ap.add_argument("--no-xml",  action="store_true")
    ap.add_argument("--seconds", type=float, default=0.0,
                    help="运行指定秒数后自动退出（0 表示一直等到 Ctrl+C）")
    args = ap.parse_args()

    topic   = args.topic or args.topic_name
    domain  = args.domain if args.domain is not None else args.domain_id

    if args.no_xml:
        xml_path = ""
    elif args.xml:
        xml_path = os.path.abspath(args.xml)
        if not os.path.exists(xml_path):
            print(f"[错误] 指定的 XML 文件不存在: {xml_path}"); sys.exit(1)
    else:
        _write_xml(_DEFAULT_XML, args.ds_ip, args.ds_port)
        xml_path = _DEFAULT_XML

    print(f"EntityRealTimeStatus 路径: {_THIS_DIR}")
    sub = CameraSubscriber(topic, domain, xml_path)
    sub.run(max_seconds=args.seconds)


if __name__ == "__main__":
    main()
