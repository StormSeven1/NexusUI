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
for a in "$@"; do
  case "$a" in
    --pull) DO_GIT_PULL=1 ;;
    --rebuild) DO_REBUILD=1 ;;
    -h|--help)
      echo "用法: $0 [--pull] [--rebuild]"
      echo "  --pull     在 $ROOT 执行 git pull --ff-only"
      echo "  --rebuild  清理前端 .next 并 pip install --upgrade"
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
docker rm -f "$NAME" 2>/dev/null || true

if [[ "$DO_REBUILD" -eq 1 ]]; then
  echo "== --rebuild：将清理 nexus-ui/.next 并在容器内刷新依赖 =="
fi

# 从 nexus-ui/.env.local 读取 NEXUS_DDS_CAMERA_STATUS_MODE（legacy | entity | both），注入 Custombackend 容器
NEXUS_DDS_CAMERA_STATUS_MODE="${NEXUS_DDS_CAMERA_STATUS_MODE:-legacy}"
if [[ -f "$ROOT/nexus-ui/.env.local" ]]; then
  _cam_dds_mode="$(grep -E '^[[:space:]]*NEXUS_DDS_CAMERA_STATUS_MODE=' "$ROOT/nexus-ui/.env.local" | tail -1 | cut -d= -f2- | xargs)"
  _cam_dds_mode="${_cam_dds_mode//$'\r'/}"
  _cam_dds_mode="${_cam_dds_mode//\"/}"
  _cam_dds_mode="${_cam_dds_mode//\'/}"
  [[ -n "$_cam_dds_mode" ]] && NEXUS_DDS_CAMERA_STATUS_MODE="$_cam_dds_mode"
fi
echo "NEXUS_DDS_CAMERA_STATUS_MODE=${NEXUS_DDS_CAMERA_STATUS_MODE}（相机 PTZ DDS：legacy=149 / entity=200）"

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
  --shm-size=64m \
  --entrypoint /bin/bash \
  "$IMG" \
  -c 'set -e; chmod +x /start.sh 2>/dev/null || true; exec /start.sh'

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
echo "      NEXUS_SPEECH_MODE=2 时容器启动会自动 apt 安装 ffmpeg（webm→wav 转码）；重建容器后生效。"
echo "      若路由/API 异常，请确认本机构建时 BACKEND_URL 与上述一致，必要时先 ./prod-build.sh 再重启。"
echo "查看日志: docker logs -f ${NAME}"
echo "进入容器: docker exec -it ${NAME} bash"
echo "停止容器: docker rm -f ${NAME}"
