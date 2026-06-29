#!/usr/bin/env bash
# 开发环境专用 WSS 网关（与 prod-start-nginx / xk_docker_prod 完全独立）
# - 监听: https://<host>:22402（默认 DEV_WSS_HTTPS_PORT）
# - 反代 dev 后端 27003 及共享明文 WS（2088 检测、8083 MQTT、12600 航迹评估）
# - 容器: xk_nginx_dev_wss（不启生产容器、不占用 21911）
#
# 用法（仓库根 NexusUI/）:
#   ./dev-wss-nginx.sh          # 重建 dev WSS Nginx
#   ./dev-wss-nginx.sh --stop   # 仅停止 dev WSS Nginx
#
# dev-start.sh 会在起 xk_docker 后自动调用本脚本（可 SKIP_DEV_WSS_NGINX=1 跳过）。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/site-host.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/site-host.env"
fi

DEV_WSS_HTTPS_PORT="${DEV_WSS_HTTPS_PORT:-22402}"
DEV_BACKEND_PORT="${DEV_BACKEND_PORT:-27003}"
MQTT_WS_BACKEND_PORT="${MQTT_WS_BACKEND_PORT:-8083}"
EO_DETECTION_WS_BACKEND_PORT="${EO_DETECTION_WS_BACKEND_PORT:-2088}"
TRACK_EVAL_WS_BACKEND_PORT="${TRACK_EVAL_WS_BACKEND_PORT:-12600}"
NGINX_CONTAINER_NAME="${DEV_WSS_NGINX_CONTAINER_NAME:-xk_nginx_dev_wss}"
NGINX_IMAGE="${NGINX_IMAGE:-nginx:alpine}"

_tunnel_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ -n "${_tunnel_ip:-}" ]] || _tunnel_ip="127.0.0.1"
TRACK_WS_BACKEND_HOST="${DEV_TRACK_WS_BACKEND_HOST:-${_tunnel_ip}}"

if [[ "${1:-}" == "--stop" ]]; then
  docker rm -f "$NGINX_CONTAINER_NAME" 2>/dev/null || true
  echo "已停止 dev WSS Nginx: $NGINX_CONTAINER_NAME"
  exit 0
fi

NGINX_DIR="$ROOT/docker/nginx"
CERT_DIR="$NGINX_DIR/certs"
CONF_FILE="$NGINX_DIR/dev-wss-https.conf"
CERT_FILE="$CERT_DIR/server.crt"
KEY_FILE="$CERT_DIR/server.key"

mkdir -p "$NGINX_DIR"

if [[ ! -f "$CERT_FILE" || ! -f "$KEY_FILE" ]]; then
  HOST_IP="${_tunnel_ip}"
  echo "未检测到证书，正在生成自签证书（IP SAN: ${HOST_IP}）..."
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -days 3650 \
    -subj "/CN=${HOST_IP}" \
    -addext "subjectAltName=IP:${HOST_IP},IP:127.0.0.1"
fi

cat > "$CONF_FILE" <<EOF
# 开发 HTTPS（:22301）专用 WSS 网关；与生产 :21911 互不共享
server {
    listen ${DEV_WSS_HTTPS_PORT} ssl;
    server_name _;

    ssl_certificate     /etc/nginx/certs/server.crt;
    ssl_certificate_key /etc/nginx/certs/server.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_timeout 10m;
    ssl_session_cache shared:SSL:10m;
    client_max_body_size 100m;

    location /wss-track/ {
        proxy_pass http://${TRACK_WS_BACKEND_HOST}:${DEV_BACKEND_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
    }

    location /ws {
        proxy_pass http://127.0.0.1:${DEV_BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
    }

    location /wss-mqtt/ {
        proxy_pass http://127.0.0.1:${MQTT_WS_BACKEND_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
    }

    location /wss-detection/ {
        proxy_pass http://127.0.0.1:${EO_DETECTION_WS_BACKEND_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
    }

    location /wss-track-eval/ {
        proxy_pass http://127.0.0.1:${TRACK_EVAL_WS_BACKEND_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
    }

    location / {
        return 404;
    }
}
EOF

echo "== dev WSS Nginx =="
echo "   容器: $NGINX_CONTAINER_NAME | 端口: ${DEV_WSS_HTTPS_PORT}"
echo "   航迹 upstream: ${TRACK_WS_BACKEND_HOST}:${DEV_BACKEND_PORT}"

docker stop "$NGINX_CONTAINER_NAME" 2>/dev/null || true
docker rm -f "$NGINX_CONTAINER_NAME" 2>/dev/null || true
# 偶发卡在 Removal In Progress：循环 stop/rm 等待 Docker 释放名称
for _ in $(seq 1 60); do
  if ! docker ps -a --format '{{.Names}}' | grep -qx "$NGINX_CONTAINER_NAME"; then
    break
  fi
  docker stop "$NGINX_CONTAINER_NAME" 2>/dev/null || true
  docker rm -f "$NGINX_CONTAINER_NAME" 2>/dev/null || true
  sleep 1
done
if docker ps -a --format '{{.Names}}' | grep -qx "$NGINX_CONTAINER_NAME"; then
  echo "错误: 无法移除旧容器 $NGINX_CONTAINER_NAME（Docker 卡在 Removal In Progress）" >&2
  echo "请稍后重试，或执行: docker rm -f $NGINX_CONTAINER_NAME && ./dev-wss-nginx.sh" >&2
  echo "仍失败时可尝试: sudo systemctl restart docker（会中断其它容器）" >&2
  exit 1
fi

docker run -d \
  --name "$NGINX_CONTAINER_NAME" \
  --restart unless-stopped \
  --network host \
  -v "${CONF_FILE}:/etc/nginx/conf.d/default.conf:ro" \
  -v "${CERT_DIR}:/etc/nginx/certs:ro" \
  "$NGINX_IMAGE" >/dev/null

echo ""
echo "✅ 开发 WSS 网关已就绪（与生产 :21911 独立）"
echo "  wss 航迹: wss://<主机>:${DEV_WSS_HTTPS_PORT}/wss-track/ws  → ${DEV_BACKEND_PORT}"
echo "  wss 检测: wss://<主机>:${DEV_WSS_HTTPS_PORT}/wss-detection/"
echo "  停止:     ./dev-wss-nginx.sh --stop  或  docker rm -f ${NGINX_CONTAINER_NAME}"
