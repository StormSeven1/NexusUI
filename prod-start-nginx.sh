#!/usr/bin/env bash
# 生产 HTTPS 启动（Nginx 反代）
# - 外部访问: https://<host>:21911
# - 内部前端: http://127.0.0.1:22411 (next start)
# - 后端保持: http://127.0.0.1:27004
# - public/app-config.prod.json 的 websocket / http.backendUrl 由本脚本写入（与 dev 的 app-config.dev.json 分离）

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/site-host.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/site-host.env"
fi

# shellcheck disable=SC1091
source "$ROOT/docker/render-prod-nginx.sh"

if [[ -f "$ROOT/site-mode.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/site-mode.env"
fi

if [[ -z "${PUBLIC_HTTPS_PORT:-}" ]]; then
  PUBLIC_HTTPS_PORT="$(load_site_mode_public_port "$ROOT")"
fi
PUBLIC_HTTPS_PORT="${PUBLIC_HTTPS_PORT:-21911}"
INTERNAL_FRONTEND_PORT="${INTERNAL_FRONTEND_PORT:-22411}"
BACKEND_PORT="${BACKEND_PORT:-27004}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:${BACKEND_PORT}}"
# 生产 HTTPS 航迹 WS：app-config.prod 27004 → wss://…:21911/ws（location /ws）。
# /wss-track/ 可选，默认同 BACKEND_PORT（28.9 deploy-28.9.sh 会 export TRACK_WS_BACKEND_PORT=$BP）。
# 开发 HTTPS WSS 由 dev-wss-nginx.sh :22402 独立提供，本脚本不依赖 dev 27003。
TRACK_WS_BACKEND_PORT="${TRACK_WS_BACKEND_PORT:-${BACKEND_PORT}}"
MQTT_WS_BACKEND_PORT="${MQTT_WS_BACKEND_PORT:-8083}"
EO_DETECTION_WS_BACKEND_PORT="${EO_DETECTION_WS_BACKEND_PORT:-2088}"
TRACK_EVAL_WS_BACKEND_PORT="${TRACK_EVAL_WS_BACKEND_PORT:-12600}"
APP_CONTAINER_NAME="${APP_CONTAINER_NAME:-xk_docker_prod}"
NGINX_CONTAINER_NAME="${NGINX_CONTAINER_NAME:-xk_nginx_prod}"
NGINX_IMAGE="${NGINX_IMAGE:-nginx:alpine}"

# Next 在生产容器内 npm run build 时才把 NEXT_PUBLIC_* 打进前端包；仅改本机 .env.local 而服务器上不提交时，
# 生产包仍为 tunnel=false → HTTPS+Nginx 下航迹断开。经由本脚本启动时默认开启隧道并设置公网 Host:端口。
_tunnel_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ -n "${_tunnel_ip:-}" ]] || _tunnel_ip="127.0.0.1"
# 航迹 WS 常见只绑定网卡 IP（如 192.168.x），未监听 127.0.0.1 → Nginx 用 127.0.0.1 反代会 502。默认与 NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT 同属网段的本机首选 IP。
TRACK_WS_BACKEND_HOST="${TRACK_WS_BACKEND_HOST:-${_tunnel_ip}}"
export NEXT_PUBLIC_WS_USE_NGINX_TUNNEL="${NEXT_PUBLIC_WS_USE_NGINX_TUNNEL:-true}"
export NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT="${NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT:-${_tunnel_ip}:${PUBLIC_HTTPS_PORT}}"
echo "== 传给生产容器前端构建（可 export 覆盖）=="
echo "   NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=${NEXT_PUBLIC_WS_USE_NGINX_TUNNEL}"
echo "   NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT=${NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT}"
echo "   TRACK_WS_BACKEND_HOST=${TRACK_WS_BACKEND_HOST}（航迹明文 WS upstream 主机）"
echo "   TRACK_WS_BACKEND_PORT=${TRACK_WS_BACKEND_PORT}（/wss-track upstream 端口）"

chmod +x "$ROOT/docker/apply-app-config-endpoints.sh" 2>/dev/null || true
_cfg_host="${APP_CONFIG_LAN_HOST:-${_tunnel_ip}}"
echo "== 写入 nexus-ui/public/app-config.prod.json（生产: API/WS ${BACKEND_PORT} @ ${_cfg_host}）=="
APP_CONFIG_OUT=app-config.prod.json "$ROOT/docker/apply-app-config-endpoints.sh" "$ROOT" "$_cfg_host" "$BACKEND_PORT" "$BACKEND_PORT"
chmod +x "$ROOT/docker/apply-proxy-links-to-app-config.sh" 2>/dev/null || true
"$ROOT/docker/apply-proxy-links-to-app-config.sh" "$ROOT"

DO_SKIP_FRONTEND_BUILD=0
PROD_START_ARGS=()
for a in "$@"; do
  case "$a" in
    --no-build) DO_SKIP_FRONTEND_BUILD=1 ;;
    *) PROD_START_ARGS+=("$a") ;;
  esac
done

if [[ "$DO_SKIP_FRONTEND_BUILD" -eq 0 ]]; then
  echo "== 宿主机 prod-build（NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=${NEXT_PUBLIC_WS_USE_NGINX_TUNNEL}）=="
  NEXT_PUBLIC_WS_USE_NGINX_TUNNEL="${NEXT_PUBLIC_WS_USE_NGINX_TUNNEL}" \
  NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT="${NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT}" \
  BACKEND_PORT="${BACKEND_PORT}" \
  BACKEND_URL="${BACKEND_URL}" \
  "$ROOT/prod-build.sh"
else
  echo "== 跳过宿主机 prod-build（--no-build）=="
fi

render_prod_nginx_conf "$ROOT"

wait_tcp_port() {
  local port="$1"
  local label="$2"
  local max_sec="${WAIT_UPSTREAM_SEC:-900}"
  local deadline=$((SECONDS + max_sec))
  echo "等待 ${label} 监听 127.0.0.1:${port}（最多 ${max_sec}s，含容器内 npm run build）..."
  while (( SECONDS < deadline )); do
    if ss -tln 2>/dev/null | grep -qE ":${port}( |$)"; then
      echo "✅ ${label} 已就绪（:${port}）"
      return 0
    fi
    sleep 5
  done
  echo "错误: ${label} 未在 ${max_sec}s 内监听 :${port}。查看: docker logs -f ${APP_CONTAINER_NAME}" >&2
  return 1
}

echo "启动应用容器（前端内部端口 ${INTERNAL_FRONTEND_PORT}，后端 ${BACKEND_PORT}）..."
# 先停 Nginx，避免 build 期间旧反代仍对外 21911 但 upstream 已断开 → 502
docker rm -f "$NGINX_CONTAINER_NAME" 2>/dev/null || true
FRONTEND_PORT="${INTERNAL_FRONTEND_PORT}" \
BACKEND_PORT="${BACKEND_PORT}" \
BACKEND_URL="${BACKEND_URL}" \
NEXUS_DOCKER_NAME="${APP_CONTAINER_NAME}" \
"$ROOT/prod-start.sh" "${PROD_START_ARGS[@]}"

wait_tcp_port "${BACKEND_PORT}" "Custombackend"
wait_tcp_port "${INTERNAL_FRONTEND_PORT}" "Next.js (next start)"

echo "启动 Nginx HTTPS 容器（外部端口 ${PUBLIC_HTTPS_PORT}）..."
restart_prod_nginx_container "$ROOT"

echo ""
echo "✅ HTTPS 已就绪"
echo "  航迹/WebSocket：浏览器经隧道连 wss；app-config 已由启动脚本按本机 IP 与端口写入。"
echo "  若仍报混合内容：确认镜像为 NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=true 重新 build。"
echo "  前端 HTTPS: https://127.0.0.1:${PUBLIC_HTTPS_PORT}/"
echo "  前端内网:   https://$(hostname -I | awk '{print $1}'):${PUBLIC_HTTPS_PORT}/"
echo "  航迹 wss（明文 ${TRACK_WS_BACKEND_HOST}:${TRACK_WS_BACKEND_PORT} → /wss-track）: wss://<主机>:${PUBLIC_HTTPS_PORT}/wss-track/ws"
echo "  Custombackend /ws（常见 ${BACKEND_PORT}）: wss://<主机>:${PUBLIC_HTTPS_PORT}/ws"
echo "  MQTT wss: wss://<主机>:${PUBLIC_HTTPS_PORT}/wss-mqtt/mqtt"
echo "  检测框 wss: wss://<主机>:${PUBLIC_HTTPS_PORT}/wss-detection/"
echo "  后端 API:   http://127.0.0.1:${BACKEND_PORT}/api"
echo ""
echo "查看 Nginx 日志: docker logs -f ${NGINX_CONTAINER_NAME}"
echo "停止 Nginx:     docker rm -f ${NGINX_CONTAINER_NAME}"
