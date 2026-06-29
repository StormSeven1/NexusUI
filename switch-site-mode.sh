#!/usr/bin/env bash
# 生产 HTTPS 模式切换
# - 日常：仅 Nginx 日常端口（NexusUI :21911）；各软件原端口直连不变
# - 演示：在日常生活基础上**追加**演示 Nginx 端口（25311–25319），不关闭 :21911
# - site-mode.env 仅存 SITE_MODE；端口见 site-proxy-services.env
#
# 用法:
#   ./switch-site-mode.sh daily    # 关闭演示 Nginx，保留日常 :21911
#   ./switch-site-mode.sh demo     # 开启演示 Nginx（日常 :21911 仍可用）
#   ./switch-site-mode.sh status

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/site-host.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/site-host.env"
fi

# shellcheck disable=SC1091
source "$ROOT/docker/render-prod-nginx.sh"

MODE=""
CUSTOM_PORT=""

usage() {
  sed -n '2,11p' "$0" | sed 's/^# \?//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    daily|demo|status)
      MODE="$1"
      shift
      ;;
    --port)
      CUSTOM_PORT="${2:?--port 需要端口号}"
      shift 2
      ;;
    -h|--help)
      usage 0
      ;;
    *)
      echo "未知参数: $1" >&2
      usage 1
      ;;
  esac
done

[[ -n "$MODE" ]] || usage 1

if [[ -f "$ROOT/site-mode.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/site-mode.env"
fi
source_proxy_services "$ROOT"
GW_ID="${PROXY_GATEWAY_SVC_ID:-NEXUSUI}"

resolve_upstream_env() {
  PUBLIC_HTTPS_PORT="${PUBLIC_HTTPS_PORT:-$(load_proxy_svc_port "$ROOT" "$GW_ID" daily)}"
  [[ "$PUBLIC_HTTPS_PORT" =~ ^[0-9]+$ && "$PUBLIC_HTTPS_PORT" -gt 0 ]] || PUBLIC_HTTPS_PORT="21911"
  INTERNAL_FRONTEND_PORT="${INTERNAL_FRONTEND_PORT:-22411}"
  BACKEND_PORT="${BACKEND_PORT:-27004}"
  TRACK_WS_BACKEND_PORT="${TRACK_WS_BACKEND_PORT:-${BACKEND_PORT}}"
  MQTT_WS_BACKEND_PORT="${MQTT_WS_BACKEND_PORT:-8083}"
  EO_DETECTION_WS_BACKEND_PORT="${EO_DETECTION_WS_BACKEND_PORT:-2088}"
  TRACK_EVAL_WS_BACKEND_PORT="${TRACK_EVAL_WS_BACKEND_PORT:-12600}"
  NGINX_CONTAINER_NAME="${NGINX_CONTAINER_NAME:-xk_nginx_prod}"
  NGINX_IMAGE="${NGINX_IMAGE:-nginx:alpine}"
  APP_CONTAINER_NAME="${APP_CONTAINER_NAME:-xk_docker_prod}"
  _tunnel_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [[ -n "${_tunnel_ip:-}" ]] || _tunnel_ip="127.0.0.1"
  TRACK_WS_BACKEND_HOST="${TRACK_WS_BACKEND_HOST:-${_tunnel_ip}}"
}

wait_port_listening() {
  local port="$1"
  local max_sec="${2:-15}"
  local deadline=$((SECONDS + max_sec))
  while (( SECONDS < deadline )); do
    if port_listening "$port"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

port_listening() {
  local port="$1"
  ss -tln 2>/dev/null | grep -qE ":${port}( |$)"
}

print_status() {
  resolve_upstream_env
  local lan="${SITE_LAN_HOST:-${_tunnel_ip}}"
  echo "当前模式:     ${SITE_MODE:-daily}"
  echo "端口配置:     site-proxy-services.env"
  echo "Nginx 容器:   ${NGINX_CONTAINER_NAME}"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$NGINX_CONTAINER_NAME"; then
    echo "容器状态:     运行中"
  else
    echo "容器状态:     未运行"
  fi
  if wait_port_listening "$PUBLIC_HTTPS_PORT" 3; then
    echo "NexusUI 日常: :${PUBLIC_HTTPS_PORT} ✅"
  else
    echo "NexusUI 日常: :${PUBLIC_HTTPS_PORT} ❌（未监听）"
  fi
  if [[ "${SITE_MODE:-daily}" == "demo" ]]; then
    local demo_gw_port
    demo_gw_port="$(load_proxy_svc_port "$ROOT" "$GW_ID" demo)"
    if [[ "$demo_gw_port" =~ ^[0-9]+$ ]] && (( demo_gw_port > 0 )) && [[ "$demo_gw_port" != "$PUBLIC_HTTPS_PORT" ]]; then
      if wait_port_listening "$demo_gw_port" 3; then
        echo "NexusUI 演示: :${demo_gw_port} ✅"
      else
        echo "NexusUI 演示: :${demo_gw_port} ❌（未监听）"
      fi
    fi
  fi
  print_proxy_services_status "$ROOT" "${SITE_MODE:-daily}" "$lan"
}

if [[ "$MODE" == "status" ]]; then
  print_status
  exit 0
fi

case "$MODE" in
  daily)
    if [[ -n "$CUSTOM_PORT" ]]; then
      write_proxy_svc_port "$ROOT" "$GW_ID" "DAILY_PORT" "$CUSTOM_PORT"
    fi
    write_site_mode_env "$ROOT" "daily"
    ;;
  demo)
    if [[ -n "$CUSTOM_PORT" ]]; then
      write_proxy_svc_port "$ROOT" "$GW_ID" "DEMO_PORT" "$CUSTOM_PORT"
    fi
    write_site_mode_env "$ROOT" "demo"
    ;;
esac

# shellcheck disable=SC1091
source "$ROOT/site-mode.env"
SITE_MODE="$MODE"
resolve_upstream_env

if ! port_listening "${INTERNAL_FRONTEND_PORT}"; then
  echo "警告: Next.js 未监听 :${INTERNAL_FRONTEND_PORT}，Nginx 启动后页面可能 502。" >&2
  echo "      请先运行: NGINX_IMAGE=nginx:alpine ./prod-start-nginx.sh --no-build" >&2
fi

if [[ "$MODE" == "demo" ]]; then
  echo "== 开启演示 Nginx（日常 :${PUBLIC_HTTPS_PORT} 保持监听）=="
else
  echo "== 关闭演示 Nginx（仅保留日常 :${PUBLIC_HTTPS_PORT}）=="
fi
render_prod_nginx_conf "$ROOT"
restart_prod_nginx_container "$ROOT"

chmod +x "$ROOT/docker/apply-proxy-links-to-app-config.sh" 2>/dev/null || true
"$ROOT/docker/apply-proxy-links-to-app-config.sh" "$ROOT"

wait_port_listening "$PUBLIC_HTTPS_PORT" 20 || echo "警告: :${PUBLIC_HTTPS_PORT} 尚未就绪（Nginx 可能仍在启动）" >&2
if [[ "$MODE" == "demo" ]]; then
  demo_gw_port="$(load_proxy_svc_port "$ROOT" "$GW_ID" demo)"
  if [[ "$demo_gw_port" =~ ^[0-9]+$ ]] && (( demo_gw_port > 0 )) && [[ "$demo_gw_port" != "$PUBLIC_HTTPS_PORT" ]]; then
    wait_port_listening "$demo_gw_port" 10 || true
  fi
fi

lan="${SITE_LAN_HOST:-${_tunnel_ip}}"
echo ""
echo "✅ 已切换到 ${MODE} 模式"
print_proxy_services_status "$ROOT" "$MODE" "$lan"
