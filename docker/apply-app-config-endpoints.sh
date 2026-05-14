#!/usr/bin/env bash
# 由 dev-start.sh / prod-start.sh / prod-start-nginx.sh 调用：按本机网络与端口写入
# nexus-ui/public/app-config.json 的 websocket.url 与 http.backendUrl（无需手改 JSON）。
#
# 用法:
#   apply-app-config-endpoints.sh <仓库根 NexusUI> <主机名或 IP> <HTTP 后端端口> [航迹 WS 端口]
# 第 4 个参数省略时与第 3 个相同（通用后端与航迹同源）。
#
# 可选环境变量（与启动脚本一致）:
#   APP_CONFIG_LAN_HOST  若已在外层设置主机，仍传入位置参数即可。

set -euo pipefail

ROOT="${1:?仓库根目录}"
HOST="${2:?主机（如 hostname -I 首地址）}"
HTTP_PORT="${3:?HTTP 后端端口}"
WS_PORT="${4:-$HTTP_PORT}"

CFG="$ROOT/nexus-ui/public/app-config.json"
if [[ ! -f "$CFG" ]]; then
  echo "错误: 缺少 $CFG" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "错误: 未找到 jq，请安装: apt install jq / yum install jq / brew install jq" >&2
  exit 1
fi

tmp="$(mktemp)"
jq --arg host "$HOST" --arg hp "$HTTP_PORT" --arg wp "$WS_PORT" '
  .websocket.url = ("ws://" + $host + ":" + $wp + "/ws") |
  .http.backendUrl = ("http://" + $host + ":" + $hp)
' "$CFG" > "$tmp"
mv "$tmp" "$CFG"
echo "== app-config 网络端点已写入: ws://${HOST}:${WS_PORT}/ws , http://${HOST}:${HTTP_PORT} =="
