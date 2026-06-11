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
#   NEXT_PUBLIC_WS_USE_NGINX_TUNNEL  默认 false
#   NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT  隧道为真时设为 <现场IP>:22401
#   开发/生产并行：端点写入 app-config.dev.json，不覆盖 app-config.prod.json（见 prod-start-nginx.sh）

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
BU="${BACKEND_URL:-http://127.0.0.1:${BP}}"
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
echo "镜像: $IMG | 容器名: $NAME | 后端端口: $BP | 前端端口: $FP"
echo "NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=${NEXT_PUBLIC_WS_USE_NGINX_TUNNEL:-false}（Docker -e 注入，覆盖 .env.local，可与 prod-start-nginx 并行）"
echo "NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT=${NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT:-（未设置）}"
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

# app-config 主机：site-host.env 绑定的现场 IP
_cfg_host="${_site_host}"
echo "== 写入 nexus-ui/public/app-config.dev.json（开发: ${_cfg_host}:${BP}）=="
APP_CONFIG_OUT=app-config.dev.json "$ROOT/docker/apply-app-config-endpoints.sh" "$ROOT" "$_cfg_host" "$BP"

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
  -e "NEXUS_DOCKER_NO_KILL=${NEXUS_DOCKER_NO_KILL:-0}" \
  -e "NEXUS_UI_CLEAN_NEXT=${DO_REBUILD}" \
  -e "NEXUS_PY_UPGRADE=${DO_REBUILD}" \
  -e "NEXUS_PY_SKIP_INSTALL=${NEXUS_PY_SKIP_INSTALL:-$(( DO_REBUILD == 0 ? 1 : 0 ))}" \
  -e "NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=${NEXT_PUBLIC_WS_USE_NGINX_TUNNEL:-false}" \
  -e "NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT=${NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT:-}" \
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

echo ""
echo "已启动容器: $NAME"
echo "  前端: https://${_site_host}:${FP}/  （自签证书，浏览器需「继续访问」）"
echo "  前端 localhost: https://127.0.0.1:${FP}/"
echo "  后端 API: http://127.0.0.1:${BP}/api  WebSocket: ws://127.0.0.1:${BP}/ws"
echo ""
echo "说明: 开发模式下每次启动会 npm install，并拉起 next dev（HTTPS）与 uvicorn（默认跳过 pip，--rebuild 时后台 pip）。"
echo "      若必须用 HTTP 前端，可在容器内 cd /workspace/nexus-ui && npm run dev:http"
echo "      浏览器读 public/app-config.dev.json（NEXT_PUBLIC_APP_CONFIG_URL），与生产 app-config.prod.json 互不覆盖。"
echo "查看日志: docker logs -f ${NAME}"
echo "进入容器: docker exec -it ${NAME} bash"
echo "停止容器: docker rm -f ${NAME}"
