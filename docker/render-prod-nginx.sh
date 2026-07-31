#!/usr/bin/env bash
# 生成 prod-https.conf 并（可选）重建 xk_nginx_prod 容器。
# 由 prod-start-nginx.sh / switch-site-mode.sh 调用；依赖已 export 的 PUBLIC_HTTPS_PORT 等变量。
#
# 用法:
#   source docker/render-prod-nginx.sh
#   render_prod_nginx_conf "$ROOT"
#   restart_prod_nginx_container "$ROOT"

set -euo pipefail

PROXY_GATEWAY_SVC_ID="${PROXY_GATEWAY_SVC_ID:-NEXUSUI}"

source_proxy_services() {
  local root="$1"
  local svc_file="$root/site-proxy-services.env"
  [[ -f "$svc_file" ]] || return 0
  # shellcheck disable=SC1090
  source "$svc_file"
  PROXY_GATEWAY_SVC_ID="${PROXY_GATEWAY_SVC_ID:-NEXUSUI}"
}

proxy_svc_is_gateway() {
  local id="$1"
  local svc_type
  eval "svc_type=\${PROXY_SVC_${id}_TYPE:-simple}"
  [[ "${svc_type,,}" == "gateway" ]]
}

load_proxy_svc_port() {
  local root="$1"
  local id="$2"
  local mode="$3"
  source_proxy_services "$root"
  case "$mode" in
    demo) eval "printf '%s' \"\${PROXY_SVC_${id}_DEMO_PORT:-0}\"" ;;
    *) eval "printf '%s' \"\${PROXY_SVC_${id}_DAILY_PORT:-0}\"" ;;
  esac
}

write_proxy_svc_port() {
  local root="$1"
  local id="$2"
  local field="$3"
  local port="$4"
  local svc_file="$root/site-proxy-services.env"
  local key="PROXY_SVC_${id}_${field}"
  [[ -f "$svc_file" ]] || { echo "错误: 缺少 $svc_file" >&2; return 1; }
  if grep -q "^${key}=" "$svc_file"; then
    sed -i "s/^${key}=.*/${key}=${port}/" "$svc_file"
  else
    echo "${key}=${port}" >> "$svc_file"
  fi
}

list_proxy_service_ids() {
  local svc_file="$1"
  [[ -f "$svc_file" ]] || return 0
  # shellcheck disable=SC1090
  source "$svc_file"
  local gw="${PROXY_GATEWAY_SVC_ID:-NEXUSUI}"
  local ids all_ids
  all_ids="$(grep -E '^PROXY_SVC_[A-Z0-9]+_ENABLED=' "$svc_file" 2>/dev/null \
    | sed -E 's/^PROXY_SVC_([A-Z0-9]+)_ENABLED=.*/\1/' | sort -u)" || true
  [[ -n "$all_ids" ]] || return 0
  if grep -q "^PROXY_SVC_${gw}_ENABLED=" "$svc_file" 2>/dev/null; then
    printf '%s\n' "$gw"
  fi
  for id in $all_ids; do
    [[ "$id" == "$gw" ]] && continue
    printf '%s\n' "$id"
  done
}

ensure_prod_nginx_certs() {
  local root="$1"
  local cert_dir="$root/docker/nginx/certs"
  local cert_file="$cert_dir/server.crt"
  local key_file="$cert_dir/server.key"
  local ca_file="$cert_dir/ca.crt"
  local gen_script="$root/scripts/gen-prod-nginx-ca-certs.sh"
  mkdir -p "$cert_dir"
  if [[ -f "$cert_file" && -f "$key_file" ]]; then
    if [[ -f "$ca_file" ]] && openssl verify -CAfile "$ca_file" "$cert_file" >/dev/null 2>&1; then
      echo "使用本地 CA 签发的生产证书（客户端需已信任 ${ca_file}）"
    else
      echo "使用已有 server.crt（自签或非本 CA）。浏览器仍会提示不安全时，请执行:"
      echo "  ${gen_script} --force"
      echo "  然后将 ${cert_dir}/ca.crt 导入客户端「受信任的根证书」"
    fi
    return 0
  fi
  if [[ -x "$gen_script" ]] || [[ -f "$gen_script" ]]; then
    echo "未检测到证书，调用本地 CA 签发脚本..."
    chmod +x "$gen_script" 2>/dev/null || true
    "$gen_script"
    return 0
  fi
  local host_ip
  host_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [[ -n "${host_ip:-}" ]] || host_ip="127.0.0.1"
  echo "未检测到证书且无 gen 脚本，回退生成自签证书（IP SAN: ${host_ip}）..."
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$key_file" \
    -out "$cert_file" \
    -days 3650 \
    -subj "/CN=${host_ip}" \
    -addext "subjectAltName=IP:${host_ip},IP:127.0.0.1"
}

render_nexusui_gateway_server() {
  local public_port="$1"
  local internal_frontend="$2"
  local backend_port="$3"
  local track_host="$4"
  local track_port="$5"
  local mqtt_port="$6"
  local eo_port="$7"
  local eval_port="$8"

  cat <<EOF

# NexusUI gateway → Next :${internal_frontend} / Custombackend :${backend_port}；对外 :${public_port}
server {
    listen ${public_port} ssl;
    server_name _;

    ssl_certificate     /etc/nginx/certs/server.crt;
    ssl_certificate_key /etc/nginx/certs/server.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_timeout 10m;
    ssl_session_cache shared:SSL:10m;
    client_max_body_size 100m;

    location /wss-track/ {
        proxy_pass http://${track_host}:${track_port}/;
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
        proxy_pass http://127.0.0.1:${mqtt_port}/;
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
        proxy_pass http://127.0.0.1:${eo_port}/;
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
        proxy_pass http://127.0.0.1:${eval_port}/;
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
        proxy_pass http://127.0.0.1:${backend_port};
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

    location = /favicon.ico {
        alias /etc/nginx/static/favicon.ico;
        default_type image/x-icon;
        access_log off;
        expires 7d;
    }

    # SSE（/api/langgraph-chat 等）必须关缓冲；Connection 勿对普通 HTTP 强制 upgrade
    # Host 须用 \$http_host（含端口）：\$host 会丢掉 :21911/:25311，导致 BFF 拼出 wss://IP/（默认 443）→ ERR_CONNECTION_REFUSED
    location / {
        proxy_pass http://127.0.0.1:${internal_frontend};
        proxy_http_version 1.1;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Forwarded-Host \$http_host;
        proxy_set_header X-Forwarded-Port \$server_port;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "";
        proxy_connect_timeout 10s;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_cache off;
        proxy_request_buffering off;
    }
}
EOF
}

render_simple_proxy_server() {
  local label="$1"
  local id="$2"
  local upstream="$3"
  local active_port="$4"
  local scheme="$5"
  local upstream_host="$6"
  local tag="$7"

  local listen_directive ssl_lines
  if [[ "${scheme,,}" == "https" ]]; then
    listen_directive="listen ${active_port} ssl;"
    ssl_lines="
    ssl_certificate     /etc/nginx/certs/server.crt;
    ssl_certificate_key /etc/nginx/certs/server.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_timeout 10m;
    ssl_session_cache shared:SSL:10m;"
  else
    listen_directive="listen ${active_port};"
    ssl_lines=""
  fi

  upstream="${upstream%/}/"

  cat <<EOF

# ${label}（${id}）${tag} → ${upstream}；Nginx :${active_port}
server {
    ${listen_directive}
    server_name _;${ssl_lines}
    client_max_body_size 100m;

    location / {
        proxy_pass ${upstream};
        proxy_http_version 1.1;
        proxy_set_header Host ${upstream_host};
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 10s;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
EOF
}

proxy_upstream_host() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import urlparse
u = urlparse(sys.argv[1].strip())
host = u.hostname or "127.0.0.1"
port = u.port or (443 if u.scheme == "https" else 80)
print(f"{host}:{port}")
PY
}

render_prod_nginx_conf() {
  local root="$1"
  local conf_file="$root/docker/nginx/prod-https.conf"

  local internal_frontend="${INTERNAL_FRONTEND_PORT:-22411}"
  local backend_port="${BACKEND_PORT:-27004}"
  local track_host="${TRACK_WS_BACKEND_HOST:?TRACK_WS_BACKEND_HOST 未设置}"
  local track_port="${TRACK_WS_BACKEND_PORT:-${backend_port}}"
  local mqtt_port="${MQTT_WS_BACKEND_PORT:-8083}"
  local eo_port="${EO_DETECTION_WS_BACKEND_PORT:-2088}"
  local eval_port="${TRACK_EVAL_WS_BACKEND_PORT:-12600}"
  local site_mode="${SITE_MODE:-daily}"
  local gw_id="${PROXY_GATEWAY_SVC_ID:-NEXUSUI}"

  ensure_prod_nginx_certs "$root"

  local daily_gw_port demo_gw_port
  daily_gw_port="$(load_proxy_svc_port "$root" "$gw_id" daily)"
  demo_gw_port="$(load_proxy_svc_port "$root" "$gw_id" demo)"
  [[ "$daily_gw_port" =~ ^[0-9]+$ && "$daily_gw_port" -gt 0 ]] || daily_gw_port="${PUBLIC_HTTPS_PORT:-21911}"

  {
    cat <<EOF
# 由 docker/render-prod-nginx.sh 生成；SITE_MODE=${site_mode}
# 日常端口始终保留；演示模式仅追加 DEMO_PORT，不关闭日常 Nginx 监听
EOF
    render_nexusui_gateway_server "$daily_gw_port" "$internal_frontend" "$backend_port" \
      "$track_host" "$track_port" "$mqtt_port" "$eo_port" "$eval_port"
    if [[ "$site_mode" == "demo" ]] && [[ "$demo_gw_port" =~ ^[0-9]+$ ]] && (( demo_gw_port > 0 )) && [[ "$demo_gw_port" != "$daily_gw_port" ]]; then
      render_nexusui_gateway_server "$demo_gw_port" "$internal_frontend" "$backend_port" \
        "$track_host" "$track_port" "$mqtt_port" "$eo_port" "$eval_port"
    fi
    render_proxy_service_blocks "$root" "$site_mode"
  } > "$conf_file"
  echo "== 已写入 ${conf_file}（模式 ${site_mode}；NexusUI 日常 :${daily_gw_port}$([[ "$site_mode" == "demo" && "$demo_gw_port" != "$daily_gw_port" ]] && echo " + 演示 :${demo_gw_port}" || echo "")）=="
}

# 日常 DAILY_PORT>0 始终输出；演示模式额外输出 DEMO_PORT>0（不替换日常）
render_proxy_service_blocks() {
  local root="$1"
  local site_mode="$2"
  local svc_file="$root/site-proxy-services.env"
  [[ -f "$svc_file" ]] || return 0
  # shellcheck disable=SC1090
  source "$svc_file"

  local ids
  ids="$(list_proxy_service_ids "$svc_file")"
  [[ -n "$ids" ]] || return 0

  local id label enabled upstream daily_port demo_port scheme upstream_host svc_type port tag
  for id in $ids; do
    eval "enabled=\${PROXY_SVC_${id}_ENABLED:-false}"
    case "${enabled,,}" in
      1|true|yes|on) ;;
      *) continue ;;
    esac
    eval "svc_type=\${PROXY_SVC_${id}_TYPE:-simple}"
    [[ "${svc_type,,}" == "gateway" ]] && continue
    eval "label=\${PROXY_SVC_${id}_LABEL:-${id}}"
    eval "upstream=\${PROXY_SVC_${id}_UPSTREAM:?PROXY_SVC_${id}_UPSTREAM 未设置}"
    eval "daily_port=\${PROXY_SVC_${id}_DAILY_PORT:-0}"
    eval "demo_port=\${PROXY_SVC_${id}_DEMO_PORT:-0}"
    eval "scheme=\${PROXY_SVC_${id}_SCHEME:-http}"
    upstream_host="$(proxy_upstream_host "$upstream")"

    for port in daily demo; do
      if [[ "$port" == "demo" && "$site_mode" != "demo" ]]; then
        continue
      fi
      local active_port
      if [[ "$port" == "daily" ]]; then
        active_port="$daily_port"
        tag="[日常 Nginx]"
      else
        active_port="$demo_port"
        tag="[演示 Nginx]"
      fi
      [[ "$active_port" =~ ^[0-9]+$ ]] || continue
      (( active_port > 0 )) || continue
      render_simple_proxy_server "$label" "$id" "$upstream" "$active_port" "$scheme" "$upstream_host" "$tag"
    done
  done
}

# 打印对外服务状态（供 switch-site-mode.sh status）
print_proxy_services_status() {
  local root="$1"
  local site_mode="$2"
  local lan="$3"
  local svc_file="$root/site-proxy-services.env"
  [[ -f "$svc_file" ]] || return 0
  # shellcheck disable=SC1090
  source "$svc_file"

  local ids
  ids="$(list_proxy_service_ids "$svc_file")"
  [[ -n "$ids" ]] || return 0

  echo ""
  echo "对外服务（模式 ${site_mode}；日常原端口不受演示切换影响）:"
  local id label enabled upstream daily_port demo_port scheme scheme_prefix svc_type listen_ok
  for id in $ids; do
    eval "enabled=\${PROXY_SVC_${id}_ENABLED:-false}"
    case "${enabled,,}" in
      1|true|yes|on) ;;
      *) continue ;;
    esac
    eval "label=\${PROXY_SVC_${id}_LABEL:-${id}}"
    eval "upstream=\${PROXY_SVC_${id}_UPSTREAM:-}"
    eval "daily_port=\${PROXY_SVC_${id}_DAILY_PORT:-0}"
    eval "demo_port=\${PROXY_SVC_${id}_DEMO_PORT:-0}"
    eval "scheme=\${PROXY_SVC_${id}_SCHEME:-http}"
    eval "svc_type=\${PROXY_SVC_${id}_TYPE:-simple}"
    scheme_prefix="${scheme}://"

    if [[ "${svc_type,,}" == "gateway" ]]; then
      if [[ "$daily_port" =~ ^[0-9]+$ ]] && (( daily_port > 0 )); then
        listen_ok="❌"
        ss -tln 2>/dev/null | grep -qE ":${daily_port}( |$)" && listen_ok="✅"
        echo "  ${label} [日常]: ${scheme_prefix}${lan}:${daily_port}/ （gateway） ${listen_ok}"
      fi
      if [[ "$site_mode" == "demo" && "$demo_port" =~ ^[0-9]+$ ]] && (( demo_port > 0 )) && [[ "$demo_port" != "$daily_port" ]]; then
        listen_ok="❌"
        ss -tln 2>/dev/null | grep -qE ":${demo_port}( |$)" && listen_ok="✅"
        echo "  ${label} [演示]: ${scheme_prefix}${lan}:${demo_port}/ （gateway） ${listen_ok}"
      fi
      continue
    fi

    if [[ "$daily_port" =~ ^[0-9]+$ ]] && (( daily_port > 0 )); then
      listen_ok="❌"
      ss -tln 2>/dev/null | grep -qE ":${daily_port}( |$)" && listen_ok="✅"
      echo "  ${label} [日常 Nginx]: ${scheme_prefix}${lan}:${daily_port}/ → ${upstream}  ${listen_ok}"
    else
      echo "  ${label} [日常直连]: ${upstream}"
    fi
    if [[ "$site_mode" == "demo" && "$demo_port" =~ ^[0-9]+$ ]] && (( demo_port > 0 )); then
      listen_ok="❌"
      ss -tln 2>/dev/null | grep -qE ":${demo_port}( |$)" && listen_ok="✅"
      echo "  ${label} [演示 Nginx]: ${scheme_prefix}${lan}:${demo_port}/ → ${upstream}  ${listen_ok}"
    fi
  done
}

restart_prod_nginx_container() {
  local root="$1"
  local conf_file="$root/docker/nginx/prod-https.conf"
  local cert_dir="$root/docker/nginx/certs"
  local nginx_name="${NGINX_CONTAINER_NAME:-xk_nginx_prod}"
  local nginx_image="${NGINX_IMAGE:-nginx:alpine}"
  local gw_id="${PROXY_GATEWAY_SVC_ID:-NEXUSUI}"
  local daily_gw_port
  daily_gw_port="$(load_proxy_svc_port "$root" "$gw_id" daily)"
  [[ "$daily_gw_port" =~ ^[0-9]+$ && "$daily_gw_port" -gt 0 ]] || daily_gw_port="${PUBLIC_HTTPS_PORT:-21911}"

  local fav_public="$root/nexus-ui/public/favicon.ico"
  local fav_fallback="$root/docker/nginx/static/favicon.ico"
  local fav_mount="$fav_public"
  [[ -f "$fav_mount" ]] || fav_mount="$fav_fallback"
  if [[ ! -f "$fav_mount" ]]; then
    echo "错误: 缺少 favicon（$fav_public 或 $fav_fallback）" >&2
    exit 1
  fi

  docker rm -f "$nginx_name" 2>/dev/null || true
  docker run -d \
    --name "$nginx_name" \
    --restart unless-stopped \
    --network host \
    -v "${conf_file}:/etc/nginx/conf.d/default.conf:ro" \
    -v "${cert_dir}:/etc/nginx/certs:ro" \
    -v "${fav_mount}:/etc/nginx/static/favicon.ico:ro" \
    "$nginx_image" >/dev/null
  echo "== Nginx 容器 ${nginx_name} 已重建（NexusUI 日常 :${daily_gw_port}；SITE_MODE=${SITE_MODE:-daily}）=="
}

load_site_mode_public_port() {
  local root="$1"
  local port
  port="$(load_proxy_svc_port "$root" "${PROXY_GATEWAY_SVC_ID:-NEXUSUI}" daily)"
  if [[ "$port" =~ ^[0-9]+$ ]] && (( port > 0 )); then
    printf '%s' "$port"
    return 0
  fi
  printf '%s' "${DAILY_PUBLIC_HTTPS_PORT:-21911}"
}

write_site_mode_env() {
  local root="$1"
  local mode="$2"
  local mode_file="$root/site-mode.env"
  cat > "$mode_file" <<EOF
# 当前运行模式 daily|demo（对外端口见 site-proxy-services.env）
SITE_MODE=${mode}
EOF
}
