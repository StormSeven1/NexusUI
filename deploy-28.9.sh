#!/usr/bin/env bash
# NexusUI 28.9 现场部署（生产 HTTPS：prod-start-nginx.sh）
# 用法：在 28.9 上 cd /home/dell/zhu_heng/NexusUI && ./deploy-28.9.sh
# 开发模式（22301/27003）：./dev-start.sh（同目录，自动 hostname -I → 28.9）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT/nexus-ui/.env.local"
HOST="192.168.28.9"
if [[ -f "$ROOT/site-host.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/site-host.env"
  HOST="${SITE_LAN_HOST:-$HOST}"
fi
BP="${BACKEND_PORT:-27004}"
FP="${PUBLIC_HTTPS_PORT:-22401}"

echo "== NexusUI 28.9 部署 =="

# 1. 生成 28.9 专用 .env.local
cat > "$ENV_FILE" <<EOF
# 28.9 现场自动生成 — $(date -Iseconds)
PORT=22301
BACKEND_URL=http://${HOST}:${BP}
NEXUS_ALARM_SERVER_URL=http://${HOST}:8019
NEXT_PUBLIC_NEXUS_TASK_MANAGEMENT_URL=http://${HOST}:8888
WatchSystemDbQaIp=${HOST}
WatchSystemDbQaPort=5670
NEXUS_SPEECH_MODE=1
NEXUS_SPEECH_ASR_URL=http://${HOST}:5222/asr
NEXT_PUBLIC_ALARM_SPEECH_ENABLED=true
TASK_STATUS_HTTP_PORT=7774
TASK_STATUS_MINIO_ENDPOINT=http://${HOST}:7000
TASK_STATUS_MINIO_ACCESS_KEY=minioadmin
TASK_STATUS_MINIO_SECRET_KEY=minioadmin
TASK_STATUS_MINIO_PRESIGN_EXPIRY_SEC=86400
NEXUS_POSTGRES_URL=postgresql://postgres:123456@${HOST}:5432/watchsystem
NEXT_PUBLIC_DB_AREAS_POLL_MS=0
TASK_STATUS_METADATA_QUERY_DELAY_MS=2000
NEXT_PUBLIC_MAP2D_STYLE_URL=/map-styles/offline-map.json
NEXT_PUBLIC_MAP2D_MINI_STYLE_URL=/map-styles/offline-map.json
NEXT_PUBLIC_MAP2D_INITIAL_CENTER=122.0890,37.5450
NEXT_PUBLIC_MAP2D_INITIAL_ZOOM=14
NEXT_PUBLIC_MAP3D_IMAGERY_URL=https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png
NEXT_PUBLIC_MAP3D_INITIAL_CENTER=122.0890,37.5450
NEXT_PUBLIC_MAP3D_INITIAL_ZOOM=14
NEXT_PUBLIC_NEXUS_CAMERA_MANAGEMENT_URL=http://${HOST}:8089
NEXUS_ENTITIES_LIST_URL=http://${HOST}:8090/api/v1/entities?page=1&size=100
NEXUS_TASK_SERVER_HOST=${HOST}
NEXUS_WEATHER_PORT=8090
NEXUS_DRONE_PLATFORM_BASE_URL=http://${HOST}:8890
NEXUS_DRONE_PLATFORM_USERNAME=adminPC
NEXUS_DRONE_PLATFORM_PASSWORD=adminPC
NEXT_PUBLIC_NEXUS_UAV_ZLM_WEBRTC_BASE_URL=http://${HOST}:91
NEXUS_UAV_MQTT_BROKER_URL=mqtt://${HOST}:1893
NEXT_PUBLIC_TRACK_EVAL_WS_URL=ws://${HOST}:12600/ws/test-client
NEXT_PUBLIC_TRACK_EVAL_USE_GRPC=true
NEXT_PUBLIC_WS_DISABLE_TRACK_INGEST=false
NEXT_PUBLIC_EO_VIDEO_WEBCODECS_CANVAS=true
NEXT_PUBLIC_EO_VIDEO_HARDWARE_PASSTHROUGH=false
VLM_IMAGE_ANALYSIS_BASE_URL=http://192.168.18.141:7860
VLM_IMAGE_ANALYSIS_MODEL=Qwen/Qwen3-VL-8B-Instruct
EOF
echo "[ok] 已写入 $ENV_FILE"

# 2. 28.9 航迹模式、相机槽位、外链 IP
python3 - "$ROOT" "$HOST" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1]) / "nexus-ui/public"
host = sys.argv[2]
link_ip = {
    "实体管理": f"http://{host}:7880/",
    "任务管理": f"http://{host}:8888/chat",
    "雷达管理": f"http://{host}:22231/dashboard",
    "相机管理": f"https://{host}:9443/home",
    "告警管理": f"http://{host}:8711/area-management",
}
for name in ("app-config.json", "app-config.prod.json", "app-config.dev.json"):
    p = root / name
    if not p.exists():
        continue
    data = json.loads(p.read_text(encoding="utf-8"))
    if "trackIdMode" in data:
        data["trackIdMode"]["distinguishSeaAir"] = True
    if "cameraManagement" in data:
        data["cameraManagement"]["host"] = host
        data["cameraManagement"]["port"] = 8089
        data["cameraManagement"]["seaCameraIndex"] = 4
        data["cameraManagement"]["skyCameraIndex"] = 8
        data["cameraManagement"]["mapFovCameraEntityIds"] = ["camera_004", "camera_008"]
    for link in data.get("softwareCompositionLinks", []):
        label = link.get("label", "")
        if label in link_ip:
            link["url"] = link_ip[label]
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] 更新 {name}: 28.9 外链 + distinguishSeaAir=true")
PY

# 3. 检查 Docker 镜像
IMG="${NEXUS_DOCKER_IMAGE:-xk_docker:latest}"
if ! docker image inspect "$IMG" >/dev/null 2>&1; then
  echo "[error] 缺少镜像 $IMG，请先导入: docker load -i xk_docker.tar" >&2
  exit 1
fi

# 4. 启动生产 HTTPS（Nginx 22401 + 内部 next 22411）
export APP_CONFIG_LAN_HOST="$HOST"
export BACKEND_PORT="$BP"
export PUBLIC_HTTPS_PORT="$FP"
export BACKEND_URL="http://127.0.0.1:${BP}"
export TRACK_WS_BACKEND_HOST="$HOST"
export TRACK_WS_BACKEND_PORT="$BP"
chmod +x "$ROOT/prod-start.sh" "$ROOT/prod-start-nginx.sh" "$ROOT/dev-start.sh" "$ROOT/docker/start.sh" 2>/dev/null || true

# Custombackend DDS XML discovery 地址 → 28.9
find "$ROOT/Custombackend" -name '*.xml' -type f -print0 2>/dev/null | while IFS= read -r -d '' f; do
  sed -i 's/192.168.18.141/192.168.28.9/g' "$f" 2>/dev/null || true
done

REBUILD_FLAG=()
for a in "$@"; do
  [[ "$a" == "--rebuild" ]] && REBUILD_FLAG=(--rebuild)
done
"$ROOT/prod-start-nginx.sh" "${REBUILD_FLAG[@]}"

echo ""
echo "== NexusUI 28.9 部署完成 =="
echo "  生产 HTTPS: https://${HOST}:${FP}/"
echo "  开发模式:   ./dev-start.sh  → https://${HOST}:22301/"
echo "  后端 API:   http://${HOST}:${BP}/api"
echo "  日志: docker logs -f xk_docker_prod | docker logs -f xk_nginx_prod"
