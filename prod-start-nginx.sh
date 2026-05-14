#!/usr/bin/env bash
# 生产 HTTPS 启动（Nginx 反代）
# - 外部访问: https://<host>:22401
# - 内部前端: http://127.0.0.1:22411 (next start)
# - 后端保持: http://127.0.0.1:27004
# - public/app-config.json 的 websocket / http.backendUrl 由本脚本自动写入（可选 APP_CONFIG_LAN_HOST）

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PUBLIC_HTTPS_PORT="${PUBLIC_HTTPS_PORT:-22401}"
INTERNAL_FRONTEND_PORT="${INTERNAL_FRONTEND_PORT:-22411}"
BACKEND_PORT="${BACKEND_PORT:-27004}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:${BACKEND_PORT}}"
# 航迹明文 WS upstream（Nginx `location /wss-track/` → 该主机端口上的 `/ws`）。
# 默认 **等于 BACKEND_PORT**（生产 xk_docker_prod 内 Custombackend 与航迹同源 **27004**；与 `dev-start.sh` 单机 **27003** 不同属刻意分工）。
# 若航迹单独起在其它端口：`export TRACK_WS_BACKEND_PORT=26003` 等覆盖。
# 须与 `public/app-config.json` → `websocket.url` / `http.backendUrl` 端口一致，否则 502 或 HTTPS 混合内容拦截。
TRACK_WS_BACKEND_PORT="${TRACK_WS_BACKEND_PORT:-${BACKEND_PORT}}"
MQTT_WS_BACKEND_PORT="${MQTT_WS_BACKEND_PORT:-8083}"
EO_DETECTION_WS_BACKEND_PORT="${EO_DETECTION_WS_BACKEND_PORT:-2088}"
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
echo "== 写入 nexus-ui/public/app-config.json（生产: API ${BACKEND_PORT} / 航迹 WS ${TRACK_WS_BACKEND_PORT} @ ${_cfg_host}）=="
"$ROOT/docker/apply-app-config-endpoints.sh" "$ROOT" "$_cfg_host" "$BACKEND_PORT" "$TRACK_WS_BACKEND_PORT"

NGINX_DIR="$ROOT/docker/nginx"
CERT_DIR="$NGINX_DIR/certs"
CONF_FILE="$NGINX_DIR/prod-https.conf"
CERT_FILE="$CERT_DIR/server.crt"
KEY_FILE="$CERT_DIR/server.key"

mkdir -p "$CERT_DIR"

if [[ ! -f "$CERT_FILE" || ! -f "$KEY_FILE" ]]; then
  HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [[ -z "${HOST_IP:-}" ]]; then
    HOST_IP="127.0.0.1"
  fi
  echo "未检测到证书，正在生成自签证书（IP SAN: ${HOST_IP}）..."
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -days 3650 \
    -subj "/CN=${HOST_IP}" \
    -addext "subjectAltName=IP:${HOST_IP},IP:127.0.0.1"
fi

cat > "$CONF_FILE" <<EOF
# HTTPS 同源 wss → 各明文 WS（与浏览器混合内容策略、wsHttpsRewrite 端口映射一致）
server {
    listen ${PUBLIC_HTTPS_PORT} ssl;
    server_name _;

    ssl_certificate     /etc/nginx/certs/server.crt;
    ssl_certificate_key /etc/nginx/certs/server.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_timeout 10m;
    ssl_session_cache shared:SSL:10m;

    location /wss-track/ {
        proxy_pass http://${TRACK_WS_BACKEND_HOST}:${TRACK_WS_BACKEND_PORT}/;
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

    location /ws {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
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

    # 图标由容器内挂载文件直连返回，不经 Next（避免 upstream 22411 未就绪/failed 时出现 favicon.ico 502）
    location = /favicon.ico {
        alias /etc/nginx/static/favicon.ico;
        default_type image/x-icon;
        access_log off;
        expires 7d;
    }

    location / {
        proxy_pass http://127.0.0.1:${INTERNAL_FRONTEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 10s;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF

echo "启动应用容器（前端内部端口 ${INTERNAL_FRONTEND_PORT}，后端 ${BACKEND_PORT}）..."
FRONTEND_PORT="${INTERNAL_FRONTEND_PORT}" \
BACKEND_PORT="${BACKEND_PORT}" \
BACKEND_URL="${BACKEND_URL}" \
NEXUS_DOCKER_NAME="${APP_CONTAINER_NAME}" \
"$ROOT/prod-start.sh"

echo "启动 Nginx HTTPS 容器（外部端口 ${PUBLIC_HTTPS_PORT}）..."
# 对已挂载的单文件改动若用 sed -i「原地换 inode」，仅 nginx -s reload 仍看得到旧副本，须 rm 后重建本容器。
docker rm -f "$NGINX_CONTAINER_NAME" 2>/dev/null || true
FAV_PUBLIC="${ROOT}/nexus-ui/public/favicon.ico"
FAV_FALLBACK="${ROOT}/docker/nginx/static/favicon.ico"
FAV_MOUNT="$FAV_PUBLIC"
[[ -f "$FAV_MOUNT" ]] || FAV_MOUNT="$FAV_FALLBACK"
if [[ ! -f "$FAV_MOUNT" ]]; then
  echo "错误: 缺少 favicon（$FAV_PUBLIC 或 $FAV_FALLBACK），请补全图标文件后再启动。" >&2
  exit 1
fi

docker run -d \
  --name "$NGINX_CONTAINER_NAME" \
  --network host \
  -v "${CONF_FILE}:/etc/nginx/conf.d/default.conf:ro" \
  -v "${CERT_DIR}:/etc/nginx/certs:ro" \
  -v "${FAV_MOUNT}:/etc/nginx/static/favicon.ico:ro" \
  "$NGINX_IMAGE" >/dev/null

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
