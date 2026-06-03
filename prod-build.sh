#!/usr/bin/env bash
# NexusUI 生产前端打包（宿主机或一次性 Docker 容器）
# 构建时写入 next.config 的 rewrites 目标，需与运行时 BACKEND_URL / 后端端口一致。
#
# 用法（在仓库根 NexusUI/）:
#   chmod +x prod-build.sh   # 首次
#   ./prod-build.sh          # 宿主机 Node 执行 npm run build
#   ./prod-build.sh --docker # 使用与 dev 相同镜像在容器内构建（无本地 Node 时）
#
# 环境变量（可选）:
#   NEXUS_DOCKER_IMAGE  默认 xk_docker:latest（仅 --docker）
#   BACKEND_PORT        默认 27004（用于设置 BACKEND_URL=http://127.0.0.1:<port>）
#   BACKEND_URL         若设置则优先于根据 BACKEND_PORT 推导（例如反代域名）
#   NEXT_PUBLIC_WS_USE_NGINX_TUNNEL / NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT
#                     与 prod-start-nginx 一致时在此 export 后再 build，否则生产包内仍为未走隧道逻辑

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

USE_DOCKER=0
for a in "$@"; do
  case "$a" in
    --docker) USE_DOCKER=1 ;;
    -h|--help)
      echo "用法: $0 [--docker]"
      echo "  --docker  在容器内 npm install/build（需镜像 NEXUS_DOCKER_IMAGE）"
      exit 0
      ;;
    *)
      echo "未知参数: $a （$0 -h）" >&2
      exit 1
      ;;
  esac
done

BP="${BACKEND_PORT:-27004}"
if [[ -n "${BACKEND_URL:-}" ]]; then
  BU="$BACKEND_URL"
else
  BU="http://127.0.0.1:${BP}"
fi

IMG="${NEXUS_DOCKER_IMAGE:-xk_docker:latest}"
UI="$ROOT/nexus-ui"

echo "== NexusUI prod-build =="
echo "仓库: $ROOT"
echo "构建时 BACKEND_URL=${BU} （Next rewrites /api/backend → 该地址）"
echo "构建时 NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=${NEXT_PUBLIC_WS_USE_NGINX_TUNNEL:-false}"
echo "构建时 NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT=${NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT:-}"
echo "构建时 NEXT_PUBLIC_APP_CONFIG_URL=${NEXT_PUBLIC_APP_CONFIG_URL:-/app-config.prod.json}"

_cfg_host="${APP_CONFIG_LAN_HOST:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
[[ -n "${_cfg_host:-}" ]] || _cfg_host="127.0.0.1"
chmod +x "$ROOT/docker/apply-app-config-endpoints.sh" 2>/dev/null || true
APP_CONFIG_OUT=app-config.prod.json "$ROOT/docker/apply-app-config-endpoints.sh" "$ROOT" "$_cfg_host" "$BP" "$BP"
export NEXT_PUBLIC_APP_CONFIG_URL="${NEXT_PUBLIC_APP_CONFIG_URL:-/app-config.prod.json}"

if [[ "$USE_DOCKER" -eq 1 ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "错误: 未找到 docker。" >&2
    exit 1
  fi
  if ! docker image inspect "$IMG" >/dev/null 2>&1; then
    echo "错误: 本地不存在镜像 $IMG" >&2
    exit 1
  fi
  echo "== Docker 内构建（${IMG}）=="
  docker run --rm \
    -e "BACKEND_URL=${BU}" \
    -e "NEXT_PUBLIC_APP_CONFIG_URL=${NEXT_PUBLIC_APP_CONFIG_URL}" \
    -e "NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=${NEXT_PUBLIC_WS_USE_NGINX_TUNNEL:-false}" \
    -e "NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT=${NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT:-}" \
    -v "${ROOT}:/workspace" \
    -w /workspace/nexus-ui \
    "$IMG" \
    bash -lc 'set -euo pipefail; npm install; npm run build'
else
  if ! command -v npm >/dev/null 2>&1; then
    echo "错误: 未找到 npm。请安装 Node.js 或使用: $0 --docker" >&2
    exit 1
  fi
  echo "== 宿主机构建 =="
  cd "$UI"
  npm install
  NEXT_PUBLIC_APP_CONFIG_URL="${NEXT_PUBLIC_APP_CONFIG_URL}" \
    NEXT_PUBLIC_WS_USE_NGINX_TUNNEL="${NEXT_PUBLIC_WS_USE_NGINX_TUNNEL:-false}" \
    NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT="${NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT:-}" \
    BACKEND_URL="$BU" npm run build
fi

echo ""
echo "✅ 构建完成: ${UI}/.next"
echo "   随后在生产环境启动可使用 ./prod-start.sh（或自行部署 .next + node）"
