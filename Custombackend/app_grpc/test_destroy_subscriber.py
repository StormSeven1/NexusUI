import json
import sys
from pathlib import Path

import grpc
from google.protobuf.json_format import MessageToDict


CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))
DESTROY_DIR = CURRENT_DIR / "grpc_services" / "destroy"
if str(DESTROY_DIR) not in sys.path:
    sys.path.insert(0, str(DESTROY_DIR))

from Custombackend.app.config import get_settings
from grpc_services.destroy import destroy_pb2, destroy_pb2_grpc


settings = get_settings()
HOST = settings.HOST
PORT = settings.DESTROY_GRPC_PORT


def main():
    target = f"{HOST}:{PORT}"
    print(f"connecting to {target}")

    with grpc.insecure_channel(target) as channel:
        stub = destroy_pb2_grpc.DestroyEventServiceStub(channel)
        request = destroy_pb2.SubscribeDestroyEventsRequest()

        try:
            for event in stub.SubscribeDestroyEvents(request):
                print("-" * 60)
                print(json.dumps(MessageToDict(event, preserving_proto_field_name=True), ensure_ascii=False, indent=2))
        except grpc.RpcError as exc:
            print(f"grpc error: code={exc.code()} details={exc.details()}")
            raise
        except KeyboardInterrupt:
            print("\nstopped by user")


if __name__ == "__main__":
    main()
