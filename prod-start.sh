#!/usr/bin/env bash
# NexusUI 生产环境一键启动：Docker 检查 → 挂载仓库起容器 → docker/start.sh（npm run build + next start + Custombackend）
# 与 dev-start.sh 区别：不传 DEV_MODE=1，前端为 HTTP（next start），默认端口 前端 21911 / 后端 27004。
#
# 用法（在仓库根 NexusUI/）:
#   chmod +x prod-start.sh   # 首次
#   ./prod-start.sh
#   ./prod-start.sh --pull     # 启动前 git pull --ff-only（需 .git）
#   ./prod-start.sh --rebuild  # 容器内清理 nexus-ui/.next 后全量 build；后端 pip --upgrade
#
# 环境变量（可选）:
#   NEXUS_DOCKER_IMAGE   默认 xk_docker:latest（须含 fastdds，DDS 航迹才工作）
#   NEXUS_DOCKER_NAME    默认 xk_docker_prod（避免与开发容器 xk_docker 同名冲突）
#   BACKEND_PORT         默认 27004
#   FRONTEND_PORT        默认 21911
#   BACKEND_URL          默认 http://127.0.0.1:${BACKEND_PORT}（须与 next 构建时 BACKEND_URL 一致）
#   BACKEND_ONLY=1       仅起 Custombackend，跳过前端
#   NEXUS_DOCKER_NO_KILL=1  不尝试 fuser 释放 FRONTEND_PORT
#   NEXUS_PY_SKIP_INSTALL=1  跳过容器内 pip install
#   NEXUS_DDS_CAMERA_STATUS_MODE  默认 legacy；可从 nexus-ui/.env.local 读取（legacy | entity | both）
#   NEXT_PUBLIC_WS_USE_NGINX_TUNNEL  默认 false；HTTPS+Nginx 生产见 prod-start-nginx.sh（会在构建时写入前端包）
#   NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT  如 192.168.18.141:21911（与浏览器访问的 host: HTTPS 端口一致）
#   APP_CONFIG_LAN_HOST  可选，写入 public/app-config.prod.json 的主机（默认 hostname -I 首地址）
#   开发/生产并行：端点写入 app-config.prod.json，不覆盖 app-config.dev.json（见 dev-start.sh）

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DO_GIT_PULL=0
DO_REBUILD=0
DO_RESTART=0
for a in "$@"; do
  case "$a" in
    --pull) DO_GIT_PULL=1 ;;
    --rebuild) DO_REBUILD=1 ;;
    --restart) DO_RESTART=1 ;;
    -h|--help)
      echo "用法: $0 [--pull] [--rebuild] [--restart]"
      echo "  --pull     在 $ROOT 执行 git pull --ff-only"
      echo "  --rebuild  清理前端 .next 并 pip install --upgrade"
      echo "  --restart  仅 docker restart 现有容器（保留容器内 apt/ffmpeg；改 NexusUI 后配合宿主机 prod-build）"
      exit 0
      ;;
    *)
      echo "未知参数: $a （$0 -h）" >&2
      exit 1
      ;;
  esac
done

IMG="${NEXUS_DOCKER_IMAGE:-xk_docker:latest}"
NAME="${NEXUS_DOCKER_NAME:-xk_docker_prod}"
BP="${BACKEND_PORT:-27004}"
FP="${FRONTEND_PORT:-21911}"
BU="${BACKEND_URL:-http://127.0.0.1:${BP}}"

echo "== NexusUI prod-start =="
echo "仓库: $ROOT"
echo "镜像: $IMG | 容器名: $NAME | 后端: $BP | 前端: $FP"
echo "BACKEND_URL=$BU （请与 prod-build / nexus-ui 构建时一致）"
echo "NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=${NEXT_PUBLIC_WS_USE_NGINX_TUNNEL:-false}"
echo "NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT=${NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT:-（未设置，依赖挂载的 nexus-ui/.env.local）}"

if ! command -v docker >/dev/null 2>&1; then
  echo "错误: 未找到 docker 命令。" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "错误: Docker 守护进程未运行或当前用户无权限。" >&2
  exit 1
fi

if ! docker image inspect "$IMG" >/dev/null 2>&1; then
  echo "错误: 本地不存在镜像 $IMG" >&2
  exit 1
fi

if [[ "$DO_GIT_PULL" -eq 1 ]]; then
  if [[ -d "$ROOT/.git" ]]; then
    echo "== git pull --ff-only =="
    git -C "$ROOT" pull --ff-only
  else
    echo "跳过 git pull：$ROOT 不是 git 仓库"
  fi
fi

START_SH="$ROOT/docker/start.sh"
if [[ ! -f "$START_SH" ]]; then
  echo "错误: 未找到 $START_SH" >&2
  exit 1
fi
chmod +x "$START_SH" 2>/dev/null || true
chmod +x "$ROOT/docker/apply-app-config-endpoints.sh" 2>/dev/null || true

_cfg_host="${APP_CONFIG_LAN_HOST:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
[[ -n "${_cfg_host:-}" ]] || _cfg_host="127.0.0.1"
echo "== 写入 nexus-ui/public/app-config.prod.json（生产容器: ${_cfg_host}:${BP}）=="
APP_CONFIG_OUT=app-config.prod.json "$ROOT/docker/apply-app-config-endpoints.sh" "$ROOT" "$_cfg_host" "$BP"

echo "== 重建容器并挂载 /workspace（生产模式，无 DEV_MODE）=="
if [[ "$DO_RESTART" -eq 1 ]] && docker inspect "$NAME" >/dev/null 2>&1; then
  echo "== --restart：docker restart ${NAME}（不删容器，跳过重复 apt/ffmpeg）=="
  docker restart "$NAME" >/dev/null
else
  docker rm -f "$NAME" 2>/dev/null || true

if [[ "$DO_REBUILD" -eq 1 ]]; then
  echo "== --rebuild：将清理 nexus-ui/.next 并在容器内刷新依赖 =="
fi

# 从 nexus-ui/.env.local 读取 NEXUS_DDS_CAMERA_STATUS_MODE（legacy | entity | both），注入 Custombackend 容器
NEXUS_DDS_CAMERA_STATUS_MODE="${NEXUS_DDS_CAMERA_STATUS_MODE:-legacy}"
NEXUS_DRONE_STATUS_TRANSPORT="${NEXUS_DRONE_STATUS_TRANSPORT:-dds}"
NEXUS_DRONE_ENTITY_GRPC_URL="${NEXUS_DRONE_ENTITY_GRPC_URL:-192.168.18.141:51070}"
NEXUS_DRONE_HOSTILE_GRPC_URL="${NEXUS_DRONE_HOSTILE_GRPC_URL:-192.168.18.141:50065}"
NEXUS_FUSION_TRACK_TRANSPORT="${NEXUS_FUSION_TRACK_TRANSPORT:-dds}"
NEXUS_TRACK_ALARM_TRANSPORT="${NEXUS_TRACK_ALARM_TRANSPORT:-embedded}"
NEXUS_NEW_TRACK_STRUCT_GRPC_URL="${NEXUS_NEW_TRACK_STRUCT_GRPC_URL:-192.168.18.141:60055}"
NEXUS_VIRTUAL_NEW_TRACK_STRUCT_GRPC_URL="${NEXUS_VIRTUAL_NEW_TRACK_STRUCT_GRPC_URL:-192.168.18.116:50065}"
NEXUS_RADAR_TRACK_TRANSPORT="${NEXUS_RADAR_TRACK_TRANSPORT:-dds}"
NEXUS_FUSION_TRACK_STREAM_GRPC_URL="${NEXUS_FUSION_TRACK_STREAM_GRPC_URL:-192.168.18.141:60056}"
NEXUS_FUSION_TRACK_GRPC_SOURCES="${NEXUS_FUSION_TRACK_GRPC_SOURCES:-}"
# 光电相机实时状态通道：dds | grpc（grpc 需 camServer SiteProfile.ini UseEntityGrpc=1 + EntityStatusGrpcPort=8092）
NEXUS_CAMERA_STATUS_TRANSPORT="${NEXUS_CAMERA_STATUS_TRANSPORT:-dds}"
NEXUS_CAMERA_ENTITY_GRPC_URL="${NEXUS_CAMERA_ENTITY_GRPC_URL:-192.168.18.141:8092}"
NEXUS_EO_CALC_RECORD_CAM_CONF_DIR="${NEXUS_EO_CALC_RECORD_CAM_CONF_DIR:-/mnt/nfs_200T/camconf}"
NEXUS_EO_AIM_PARAM_AIM_PATH_ROOT="${NEXUS_EO_AIM_PARAM_AIM_PATH_ROOT:-\\\\192.168.18.142\\store_200T\\camconf}"
NEXUS_EO_AIM_PARAM_GRPC_ADDR="${NEXUS_EO_AIM_PARAM_GRPC_ADDR:-192.168.18.108:50052}"
NEXUS_EO_AIM_TRACK_COLLECT_GRPC_ADDR="${NEXUS_EO_AIM_TRACK_COLLECT_GRPC_ADDR:-192.168.18.108:50055}"
if [[ -f "$ROOT/nexus-ui/.env.local" ]]; then
  _cam_dds_mode="$(grep -E '^[[:space:]]*NEXUS_DDS_CAMERA_STATUS_MODE=' "$ROOT/nexus-ui/.env.local" | tail -1 | cut -d= -f2- | xargs)"
  _cam_dds_mode="${_cam_dds_mode//$'\r'/}"
  _cam_dds_mode="${_cam_dds_mode//\"/}"
  _cam_dds_mode="${_cam_dds_mode//\'/}"
  [[ -n "$_cam_dds_mode" ]] && NEXUS_DDS_CAMERA_STATUS_MODE="$_cam_dds_mode"

  _read_env_local() {
    local key="$1"
    # 支持双引号多行值（如 NEXUS_FUSION_TRACK_GRPC_SOURCES）；读出后换行压成逗号便于 docker -e
    python3 - "$ROOT/nexus-ui/.env.local" "$key" <<'PY' 2>/dev/null || true
import sys
from pathlib import Path
path, key = Path(sys.argv[1]), sys.argv[2]
if not path.is_file():
    raise SystemExit(0)
lines = path.read_text(encoding="utf-8").splitlines()
i = 0
val = None
while i < len(lines):
    raw = lines[i]
    s = raw.lstrip("\ufeff").lstrip()
    if not s or s.startswith("#") or not s.startswith(key + "="):
        i += 1
        continue
    body = s[len(key) + 1 :]
    if body.startswith('"'):
        chunks = [body[1:]]
        if chunks[0].endswith('"') and not chunks[0].endswith('\\"'):
            val = chunks[0][:-1]
        else:
            i += 1
            while i < len(lines):
                ln = lines[i]
                if ln.rstrip().endswith('"') and not ln.rstrip().endswith('\\"'):
                    chunks.append(ln.rstrip()[:-1])
                    break
                chunks.append(ln)
                i += 1
            val = "\n".join(chunks)
        val = val.replace("\\n", "\n").replace('\\"', '"')
    elif body.startswith("'"):
        val = body[1:-1] if body.endswith("'") else body[1:]
    else:
        val = body.strip()
    break
if val is None:
    raise SystemExit(0)
flat = ",".join(p.strip() for p in val.replace("\r", "\n").split("\n") if p.strip())
sys.stdout.write(flat)
PY
  }
  _v="$(_read_env_local NEXUS_EO_CALC_RECORD_CAM_CONF_DIR)"; [[ -n "$_v" ]] && NEXUS_EO_CALC_RECORD_CAM_CONF_DIR="$_v"
  _v="$(_read_env_local NEXUS_EO_AIM_PARAM_AIM_PATH_ROOT)"; [[ -n "$_v" ]] && NEXUS_EO_AIM_PARAM_AIM_PATH_ROOT="$_v"
  _v="$(_read_env_local NEXUS_EO_AIM_PARAM_GRPC_ADDR)"; [[ -n "$_v" ]] && NEXUS_EO_AIM_PARAM_GRPC_ADDR="$_v"
  _v="$(_read_env_local NEXUS_EO_AIM_TRACK_COLLECT_URL)"; [[ -n "$_v" ]] && NEXUS_EO_AIM_TRACK_COLLECT_GRPC_ADDR="$_v"
  _v="$(_read_env_local NEXUS_EO_AIM_TRACK_COLLECT_GRPC_ADDR)"; [[ -n "$_v" ]] && NEXUS_EO_AIM_TRACK_COLLECT_GRPC_ADDR="$_v"
  _v="$(_read_env_local NEXUS_DRONE_STATUS_TRANSPORT)"; [[ -n "$_v" ]] && NEXUS_DRONE_STATUS_TRANSPORT="$_v"
  _v="$(_read_env_local NEXUS_DRONE_ENTITY_GRPC_URL)"; [[ -n "$_v" ]] && NEXUS_DRONE_ENTITY_GRPC_URL="$_v"
  _v="$(_read_env_local NEXUS_DRONE_HOSTILE_GRPC_URL)"; [[ -n "$_v" ]] && NEXUS_DRONE_HOSTILE_GRPC_URL="$_v"
  _v="$(_read_env_local NEXUS_FUSION_TRACK_TRANSPORT)"; [[ -n "$_v" ]] && NEXUS_FUSION_TRACK_TRANSPORT="$_v"
  _v="$(_read_env_local NEXUS_TRACK_ALARM_TRANSPORT)"; [[ -n "$_v" ]] && NEXUS_TRACK_ALARM_TRANSPORT="$_v"
  _v="$(_read_env_local NEXUS_NEW_TRACK_STRUCT_GRPC_URL)"; [[ -n "$_v" ]] && NEXUS_NEW_TRACK_STRUCT_GRPC_URL="$_v"
  _v="$(_read_env_local NEXUS_VIRTUAL_NEW_TRACK_STRUCT_GRPC_URL)"; [[ -n "$_v" ]] && NEXUS_VIRTUAL_NEW_TRACK_STRUCT_GRPC_URL="$_v"
  _v="$(_read_env_local NEXUS_RADAR_TRACK_TRANSPORT)"; [[ -n "$_v" ]] && NEXUS_RADAR_TRACK_TRANSPORT="$_v"
  _v="$(_read_env_local NEXUS_FUSION_TRACK_STREAM_GRPC_URL)"; [[ -n "$_v" ]] && NEXUS_FUSION_TRACK_STREAM_GRPC_URL="$_v"
  _v="$(_read_env_local NEXUS_FUSION_TRACK_GRPC_SOURCES)"; [[ -n "$_v" ]] && NEXUS_FUSION_TRACK_GRPC_SOURCES="$_v"
  _v="$(_read_env_local NEXUS_CAMERA_STATUS_TRANSPORT)"; [[ -n "$_v" ]] && NEXUS_CAMERA_STATUS_TRANSPORT="$_v"
  _v="$(_read_env_local NEXUS_CAMERA_ENTITY_GRPC_URL)"; [[ -n "$_v" ]] && NEXUS_CAMERA_ENTITY_GRPC_URL="$_v"
  _v="$(_read_env_local NEXUS_ENTITIES_LIST_URL)"; [[ -n "$_v" ]] && NEXUS_ENTITIES_LIST_URL="$_v"
  _v="$(_read_env_local NEXUS_ENTITIES_AUTH_ENABLED)"; [[ -n "$_v" ]] && NEXUS_ENTITIES_AUTH_ENABLED="$_v"
  _v="$(_read_env_local NEXUS_ENTITIES_KEYCLOAK_CLIENT_ID)"; [[ -n "$_v" ]] && NEXUS_ENTITIES_KEYCLOAK_CLIENT_ID="$_v"
  _v="$(_read_env_local NEXUS_ENTITIES_KEYCLOAK_USERNAME)"; [[ -n "$_v" ]] && NEXUS_ENTITIES_KEYCLOAK_USERNAME="$_v"
  _v="$(_read_env_local NEXUS_ENTITIES_KEYCLOAK_PASSWORD)"; [[ -n "$_v" ]] && NEXUS_ENTITIES_KEYCLOAK_PASSWORD="$_v"
  _v="$(_read_env_local NEXUS_ENTITIES_BEARER_TOKEN)"; [[ -n "$_v" ]] && NEXUS_ENTITIES_BEARER_TOKEN="$_v"
  _v="$(_read_env_local KEYCLOAK_URL)"; [[ -n "$_v" ]] && KEYCLOAK_URL="$_v"
  _v="$(_read_env_local KEYCLOAK_REALM)"; [[ -n "$_v" ]] && KEYCLOAK_REALM="$_v"
fi
echo "NEXUS_ENTITIES_LIST_URL=${NEXUS_ENTITIES_LIST_URL:-（未设，Custombackend 将用 SITE_LAN_HOST 推导）}"
echo "NEXUS_DDS_CAMERA_STATUS_MODE=${NEXUS_DDS_CAMERA_STATUS_MODE}（相机 PTZ DDS：legacy=149 / entity=200）"
echo "NEXUS_CAMERA_STATUS_TRANSPORT=${NEXUS_CAMERA_STATUS_TRANSPORT}（光电视场：dds | grpc(camServer :${NEXUS_CAMERA_ENTITY_GRPC_URL##*:})）"
echo "NEXUS_DRONE_STATUS_TRANSPORT=${NEXUS_DRONE_STATUS_TRANSPORT}（无人机：dds | grpc）"
echo "NEXUS_FUSION_TRACK_TRANSPORT=${NEXUS_FUSION_TRACK_TRANSPORT}（对空/对海融合：dds | grpc）"
echo "NEXUS_TRACK_ALARM_TRANSPORT=${NEXUS_TRACK_ALARM_TRANSPORT}（航迹告警：embedded | dds）"
echo "NEXUS_RADAR_TRACK_TRANSPORT=${NEXUS_RADAR_TRACK_TRANSPORT}（传感器旁路航迹：dds | grpc(:60056)）"
echo "NEXUS_EO_CALC_RECORD_CAM_CONF_DIR=${NEXUS_EO_CALC_RECORD_CAM_CONF_DIR}（跟踪采集 camConf 写入）"

# 必须挂载整棵 /mnt/nfs_200T：仅 bind camconf 子目录时，容器内 read/write 易在 NFS 上卡死
NFS_200T_ROOT="/mnt/nfs_200T"
NFS_MOUNT_ARGS=()
if mountpoint -q "$NFS_200T_ROOT" 2>/dev/null || grep -qs " on ${NFS_200T_ROOT} " /proc/mounts 2>/dev/null; then
  NFS_MOUNT_ARGS=(-v "${NFS_200T_ROOT}:${NFS_200T_ROOT}")
  echo "NFS 200T 整树挂载: ${NFS_200T_ROOT} → 容器同路径"
elif [[ -d "$NEXUS_EO_CALC_RECORD_CAM_CONF_DIR" ]]; then
  NFS_MOUNT_ARGS=(-v "${NEXUS_EO_CALC_RECORD_CAM_CONF_DIR}:${NEXUS_EO_CALC_RECORD_CAM_CONF_DIR}")
  echo "警告: ${NFS_200T_ROOT} 非 mountpoint，退化为仅 camconf 子目录（容器内读写可能卡住）" >&2
else
  echo "警告: camConf 目录不存在 ${NEXUS_EO_CALC_RECORD_CAM_CONF_DIR}，跟踪采集将写入容器内本地路径" >&2
fi

docker run -d \
  --name "$NAME" \
  --restart unless-stopped \
  --network host \
  --cgroupns=host \
  -e TZ=Asia/Shanghai \
  -e "EPROSIMA_IMAGE=Fast DDS" \
  -e DEBIAN_FRONTEND=noninteractive \
  -e "BACKEND_PORT=${BP}" \
  -e "FRONTEND_PORT=${FP}" \
  -e "BACKEND_URL=${BU}" \
  -e "BACKEND_ONLY=${BACKEND_ONLY:-0}" \
  -e "NEXUS_DDS_CAMERA_STATUS_MODE=${NEXUS_DDS_CAMERA_STATUS_MODE}" \
  -e "NEXUS_DRONE_STATUS_TRANSPORT=${NEXUS_DRONE_STATUS_TRANSPORT}" \
  -e "NEXUS_DRONE_ENTITY_GRPC_URL=${NEXUS_DRONE_ENTITY_GRPC_URL}" \
  -e "NEXUS_DRONE_HOSTILE_GRPC_URL=${NEXUS_DRONE_HOSTILE_GRPC_URL}" \
  -e "NEXUS_FUSION_TRACK_TRANSPORT=${NEXUS_FUSION_TRACK_TRANSPORT}" \
  -e "NEXUS_TRACK_ALARM_TRANSPORT=${NEXUS_TRACK_ALARM_TRANSPORT}" \
  -e "NEXUS_NEW_TRACK_STRUCT_GRPC_URL=${NEXUS_NEW_TRACK_STRUCT_GRPC_URL}" \
  -e "NEXUS_VIRTUAL_NEW_TRACK_STRUCT_GRPC_URL=${NEXUS_VIRTUAL_NEW_TRACK_STRUCT_GRPC_URL}" \
  -e "NEXUS_RADAR_TRACK_TRANSPORT=${NEXUS_RADAR_TRACK_TRANSPORT}" \
  -e "NEXUS_FUSION_TRACK_STREAM_GRPC_URL=${NEXUS_FUSION_TRACK_STREAM_GRPC_URL}" \
  -e "NEXUS_FUSION_TRACK_GRPC_SOURCES=${NEXUS_FUSION_TRACK_GRPC_SOURCES}" \
  -e "NEXUS_CAMERA_STATUS_TRANSPORT=${NEXUS_CAMERA_STATUS_TRANSPORT}" \
  -e "NEXUS_CAMERA_ENTITY_GRPC_URL=${NEXUS_CAMERA_ENTITY_GRPC_URL}" \
  -e "NEXUS_ENTITIES_LIST_URL=${NEXUS_ENTITIES_LIST_URL:-}" \
  -e "NEXUS_ENTITIES_AUTH_ENABLED=${NEXUS_ENTITIES_AUTH_ENABLED:-}" \
  -e "NEXUS_ENTITIES_KEYCLOAK_CLIENT_ID=${NEXUS_ENTITIES_KEYCLOAK_CLIENT_ID:-}" \
  -e "NEXUS_ENTITIES_KEYCLOAK_USERNAME=${NEXUS_ENTITIES_KEYCLOAK_USERNAME:-}" \
  -e "NEXUS_ENTITIES_KEYCLOAK_PASSWORD=${NEXUS_ENTITIES_KEYCLOAK_PASSWORD:-}" \
  -e "NEXUS_ENTITIES_BEARER_TOKEN=${NEXUS_ENTITIES_BEARER_TOKEN:-}" \
  -e "KEYCLOAK_URL=${KEYCLOAK_URL:-}" \
  -e "KEYCLOAK_REALM=${KEYCLOAK_REALM:-}" \
  -e "NEXUS_EO_AIM_PARAM_GRPC_ADDR=${NEXUS_EO_AIM_PARAM_GRPC_ADDR}" \
  -e "NEXUS_EO_AIM_TRACK_COLLECT_GRPC_ADDR=${NEXUS_EO_AIM_TRACK_COLLECT_GRPC_ADDR}" \
  -e "NEXUS_EO_AIM_TRACK_COLLECT_URL=${NEXUS_EO_AIM_TRACK_COLLECT_GRPC_ADDR}" \
  -e "NEXUS_DOCKER_NO_KILL=${NEXUS_DOCKER_NO_KILL:-0}" \
  -e "NEXUS_UI_CLEAN_NEXT=${DO_REBUILD}" \
  -e "NEXUS_UI_SKIP_BUILD=${NEXUS_UI_SKIP_BUILD:-$(( DO_REBUILD == 0 ? 1 : 0 ))}" \
  -e "NEXUS_PY_UPGRADE=${DO_REBUILD}" \
  -e "NEXUS_PY_SKIP_INSTALL=${NEXUS_PY_SKIP_INSTALL:-$(( DO_REBUILD == 0 ? 1 : 0 ))}" \
  -e "NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=${NEXT_PUBLIC_WS_USE_NGINX_TUNNEL:-false}" \
  -e "NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT=${NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT:-}" \
  -e "NEXT_PUBLIC_APP_CONFIG_URL=/app-config.prod.json" \
  -v "${ROOT}:/workspace" \
  -v "${START_SH}:/start.sh:ro" \
  "${NFS_MOUNT_ARGS[@]}" \
  --shm-size=64m \
  --entrypoint /bin/bash \
  "$IMG" \
  -c 'set -e; chmod +x /start.sh 2>/dev/null || true; exec /start.sh'
fi

sleep 2
running="$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null || echo false)"
if [[ "$running" != "true" ]]; then
  echo "错误: 容器 ${NAME} 未在运行。最近日志:" >&2
  docker logs "$NAME" 2>&1 | tail -100 >&2 || true
  exit 1
fi

echo ""
echo "已启动生产容器: $NAME"
echo "  前端:     http://127.0.0.1:${FP}/"
echo "  后端 API: http://127.0.0.1:${BP}/api  WebSocket: ws://127.0.0.1:${BP}/ws"
echo ""
echo "说明: 容器内默认跳过 pip / 跳过 npm run build（已有 .next）；改代码或 NEXT_PUBLIC_* 后用 --rebuild。"
echo "      浏览器读 public/app-config.prod.json（与开发 app-config.dev.json 互不覆盖）。"
echo "      NEXUS_SPEECH_MODE=2 时 ffmpeg 在容器内后台 apt 安装（不阻塞 :${BP}）；仅改 NexusUI 建议 ./prod-build.sh && $0 --restart。"
echo "      若路由/API 异常，请确认本机构建时 BACKEND_URL 与上述一致，必要时先 ./prod-build.sh 再重启。"
echo "查看日志: docker logs -f ${NAME}"
echo "进入容器: docker exec -it ${NAME} bash"
echo "停止容器: docker rm -f ${NAME}"
