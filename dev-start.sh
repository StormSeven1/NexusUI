#!/usr/bin/env bash
# NexusUI 开发环境一键启动：Docker 检查 → 挂载仓库起容器 → 容器内执行 docker/start.sh（前后端 + 依赖更新）
#
# 用法（在仓库根 NexusUI/）:
#   chmod +x dev-start.sh   # 首次
#   ./dev-start.sh
#   ./dev-start.sh --pull     # 启动前 git pull --ff-only（需 .git）
#   ./dev-start.sh --rebuild  # 删除整个 nexus-ui/.next 并刷新依赖（默认仅清 .next/dev，保留生产 server/）
#
# 环境变量（可选）:
#   NEXUS_DOCKER_IMAGE   默认 xk_docker:latest（须能 import fastdds，航迹 DDS 才工作；否则会跳过全部 DDS）
#   NEXUS_DOCKER_NAME    默认 xk_docker
#   BACKEND_PORT         默认 27003
#   FRONTEND_PORT        默认 22301（与 nexus-ui/.env.local 中 PORT 一致为宜）
#   FRONTEND_HTTPS_SAN_IP  可选，写入 dev 证书 SAN；默认 site-host.env → SITE_LAN_HOST
#   APP_CONFIG_LAN_HOST  可选，覆盖 site-host.env 写入 app-config.dev.json 的主机
#   BACKEND_URL          默认 http://127.0.0.1:${BACKEND_PORT}
#   BACKEND_ONLY=1       仅起 Custombackend
#   NEXUS_DOCKER_NO_KILL=1  不尝试 fuser 释放 FRONTEND_PORT
#   NEXUS_PY_SKIP_INSTALL=1  跳过容器内 pip install（默认：非 --rebuild 时跳过，避免阻塞 uvicorn）
#   NEXT_PUBLIC_WS_USE_NGINX_TUNNEL  默认 true（dev-wss-nginx :22402）
#   NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT  默认 <现场IP>:22402（DEV_WSS_HTTPS_PORT）
#   SKIP_DEV_WSS_NGINX=1  跳过 dev-wss-nginx（纯 HTTP 前端或手动控制时）
#   开发/生产并行：app-config.dev.json / dev-wss :22402 与 prod app-config.prod.json / :21911 互不覆盖

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
      echo "  --pull     在 $ROOT 执行 git pull --ff-only（需为 git 仓库）"
      echo "  --rebuild  清理前端 .next 并升级 pip 依赖（大改依赖时用）"
      exit 0
      ;;
    *)
      echo "未知参数: $a （$0 -h）" >&2
      exit 1
      ;;
  esac
done

IMG="${NEXUS_DOCKER_IMAGE:-xk_docker:latest}"

# 现场 IP / 端口 / 容器名：site-host.env（18.141 与 28.9 各一套，可并行）
# shellcheck source=docker/read-site-host.sh
source "$ROOT/docker/read-site-host.sh"
if [[ -f "$ROOT/site-host.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/site-host.env"
fi
_site_host="${APP_CONFIG_LAN_HOST:-${SITE_LAN_HOST:-$(read_site_lan_host "$ROOT")}}"
if [[ -z "${_site_host:-}" ]]; then
  _site_host="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
[[ -n "${_site_host:-}" ]] || _site_host="127.0.0.1"
_access_host="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ -n "${_access_host:-}" ]] || _access_host="127.0.0.1"
NAME="${NEXUS_DOCKER_NAME:-xk_docker}"
BP="${BACKEND_PORT:-${DEV_BACKEND_PORT:-27003}}"
FP="${FRONTEND_PORT:-${DEV_FRONTEND_PORT:-22301}}"
DEV_WSS_PORT="${DEV_WSS_HTTPS_PORT:-22402}"
BU="${BACKEND_URL:-http://127.0.0.1:${BP}}"
DEV_WSS_HOSTPORT="${APP_CONFIG_LAN_HOST:-${_site_host}}:${DEV_WSS_PORT}"
if [[ -z "${FRONTEND_HTTPS_SAN_IP:-}" ]]; then
  if [[ "${_access_host}" != "${_site_host}" ]]; then
    FRONTEND_HTTPS_SAN_IP="${_access_host},${_site_host}"
  else
    FRONTEND_HTTPS_SAN_IP="${_access_host}"
  fi
fi

echo "== NexusUI dev-start =="
echo "仓库: $ROOT"
echo "现场 IP（site-host.env）: ${_site_host}"
if [[ "${_access_host}" != "${_site_host}" ]]; then
  echo "⚠️  本机 IP=${_access_host}，与 site-host.env 的 ${_site_host} 不一致。"
  echo "    本脚本应在 ${_site_host} 机器上执行；在其它机器跑只会起本地 Docker，浏览器请用 https://${_access_host}:${FP}/"
  echo "    要访问 https://${_site_host}:${FP}/ 请 SSH 到 ${_site_host} 再执行 dev-start.sh。"
fi
echo "镜像: $IMG | 容器名: $NAME | 后端端口: $BP | 前端端口: $FP | dev WSS: ${DEV_WSS_PORT}"
echo "NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=${NEXT_PUBLIC_WS_USE_NGINX_TUNNEL:-true}（dev WSS :${DEV_WSS_PORT}，与 prod :21911 独立）"
echo "NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT=${NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT:-${DEV_WSS_HOSTPORT}}"
if [[ -n "${FRONTEND_HTTPS_SAN_IP:-}" ]]; then
  echo "前端 HTTPS 证书 SAN 含 IP: ${FRONTEND_HTTPS_SAN_IP} （可覆盖: FRONTEND_HTTPS_SAN_IP=其他IP 逗号分隔）"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "错误: 未找到 docker 命令，请先安装 Docker。" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "错误: Docker 守护进程未运行或当前用户无权限（试试 sudo 或加入 docker 组）。" >&2
  exit 1
fi

if ! docker image inspect "$IMG" >/dev/null 2>&1; then
  echo "错误: 本地不存在镜像 $IMG" >&2
  echo "请先构建或拉取，或设置 NEXUS_DOCKER_IMAGE=你的镜像:tag" >&2
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
  echo "错误: 未找到 $START_SH（请保留仓库内 docker/start.sh）" >&2
  exit 1
fi
chmod +x "$START_SH" 2>/dev/null || true
chmod +x "$ROOT/docker/apply-app-config-endpoints.sh" 2>/dev/null || true
chmod +x "$ROOT/dev-wss-nginx.sh" 2>/dev/null || true

# app-config 主机：site-host.env 绑定的现场 IP
_cfg_host="${_site_host}"
echo "== 写入 nexus-ui/public/app-config.dev.json（开发: ${_cfg_host}:${BP}）=="
APP_CONFIG_OUT=app-config.dev.json "$ROOT/docker/apply-app-config-endpoints.sh" "$ROOT" "$_cfg_host" "$BP"
chmod +x "$ROOT/docker/apply-proxy-links-to-app-config.sh" 2>/dev/null || true
"$ROOT/docker/apply-proxy-links-to-app-config.sh" "$ROOT"

_next_dir="$ROOT/nexus-ui/.next"
if [[ "$DO_REBUILD" -eq 1 && -d "$_next_dir" ]]; then
  echo "== --rebuild：宿主机清理整个 nexus-ui/.next =="
  if ! rm -rf "$_next_dir" 2>/dev/null; then
    _next_bak="${_next_dir}.bak.$(date +%s)"
    echo "⚠️  rm 失败，重命名为 $(basename "$_next_bak")（多为文件被占用）"
    mv "$_next_dir" "$_next_bak" || {
      echo "错误: 无法移动 $_next_dir。请先 docker rm -f ${NAME} 再执行: mv nexus-ui/.next nexus-ui/.next.old" >&2
      exit 1
    }
    rm -rf "$_next_bak" 2>/dev/null &
  fi
elif [[ -f "$_next_dir/BUILD_ID" && -d "$_next_dir/server" ]]; then
  if [[ -d "$_next_dir/dev" ]]; then
    echo "== 宿主机清理 nexus-ui/.next/dev（保留生产构建，可与 prod 并行）=="
    rm -rf "$_next_dir/dev" 2>/dev/null || true
  fi
elif [[ -d "$_next_dir" ]]; then
  echo "== 宿主机清理 nexus-ui/.next（无完整生产构建）=="
  if ! rm -rf "$_next_dir" 2>/dev/null; then
    _next_bak="${_next_dir}.bak.$(date +%s)"
    echo "⚠️  rm 失败，重命名为 $(basename "$_next_bak")（多为文件被占用）"
    mv "$_next_dir" "$_next_bak" || {
      echo "错误: 无法移动 $_next_dir。请先 docker rm -f ${NAME} 再执行: mv nexus-ui/.next nexus-ui/.next.old" >&2
      exit 1
    }
    rm -rf "$_next_bak" 2>/dev/null &
  fi
fi

echo "== 重建容器并挂载 /workspace =="
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
# 多行列表压成单行逗号分隔，避免 docker -e 断行
flat = ",".join(p.strip() for p in val.replace("\r", "\n").split("\n") if p.strip())
sys.stdout.write(flat)
PY
  }
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
fi

docker run -d \
  --name "$NAME" \
  --user 0:0 \
  --network host \
  --cgroupns=host \
  -e DEV_MODE=1 \
  -e TZ=Asia/Shanghai \
  -e "EPROSIMA_IMAGE=Fast DDS" \
  -e DEBIAN_FRONTEND=noninteractive \
  -e "BACKEND_PORT=${BP}" \
  -e "FRONTEND_PORT=${FP}" \
  -e "FRONTEND_HTTPS_SAN_IP=${FRONTEND_HTTPS_SAN_IP:-}" \
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
  -e "NEXUS_DOCKER_NO_KILL=${NEXUS_DOCKER_NO_KILL:-0}" \
  -e "NEXUS_UI_CLEAN_NEXT=${DO_REBUILD}" \
  -e "NEXUS_PY_UPGRADE=${DO_REBUILD}" \
  -e "NEXUS_PY_SKIP_INSTALL=${NEXUS_PY_SKIP_INSTALL:-$(( DO_REBUILD == 0 ? 1 : 0 ))}" \
  -e "NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=${NEXT_PUBLIC_WS_USE_NGINX_TUNNEL:-true}" \
  -e "NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT=${NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT:-${DEV_WSS_HOSTPORT}}" \
  -e "NEXT_PUBLIC_APP_CONFIG_URL=/app-config.dev.json" \
  -v "${ROOT}:/workspace" \
  -v "${START_SH}:/start.sh:ro" \
  --shm-size=64m \
  --entrypoint /bin/bash \
  "$IMG" \
  -c 'set -e; chmod +x /start.sh 2>/dev/null || true; exec /start.sh'

sleep 2
running="$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null || echo false)"
if [[ "$running" != "true" ]]; then
  echo "错误: 容器 ${NAME} 未在运行或已退出。最近日志:" >&2
  docker logs "$NAME" 2>&1 | tail -100 >&2 || true
  exit 1
fi

if [[ "${SKIP_DEV_WSS_NGINX:-0}" != "1" ]]; then
  echo "== 启动开发 WSS 网关（:${DEV_WSS_PORT}，独立于 prod :21911）=="
  DEV_WSS_HTTPS_PORT="${DEV_WSS_PORT}" DEV_BACKEND_PORT="${BP}" "$ROOT/dev-wss-nginx.sh"
else
  echo "== 跳过 dev-wss-nginx（SKIP_DEV_WSS_NGINX=1）=="
fi

echo ""
echo "已启动容器: $NAME"
echo "  前端: https://${_site_host}:${FP}/  （自签证书，浏览器需「继续访问」）"
echo "  前端 localhost: https://127.0.0.1:${FP}/"
echo "  后端 API: http://127.0.0.1:${BP}/api  WebSocket: ws://127.0.0.1:${BP}/ws"
echo ""
echo "说明: 开发模式下每次启动会 npm install，并拉起 next dev（HTTPS）与 uvicorn（默认跳过 pip，--rebuild 时后台 pip）。"
echo "      NEXUS_SPEECH_MODE=2 时容器启动会自动 apt 安装 ffmpeg（webm→wav 转码）。"
echo "      若必须用 HTTP 前端，可在容器内 cd /workspace/nexus-ui && npm run dev:http"
echo "      浏览器读 public/app-config.dev.json；HTTPS 下 WSS 走 wss://<主机>:${DEV_WSS_PORT}/（dev-wss-nginx，与 prod :21911 无关）。"
echo "      停止 dev WSS: ./dev-wss-nginx.sh --stop"
echo "查看日志: docker logs -f ${NAME}"
echo "进入容器: docker exec -it ${NAME} bash"
echo "停止容器: docker rm -f ${NAME}"
