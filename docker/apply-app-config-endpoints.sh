#!/usr/bin/env bash
# 由 dev-start.sh / prod-start.sh / prod-start-nginx.sh 调用：从 public/app-config.json
# 复制并写入 websocket.url / http.backendUrl 到指定输出文件（开发/生产并行时互不覆盖）。
#
# 用法:
#   apply-app-config-endpoints.sh <仓库根 NexusUI> <主机名或 IP> <HTTP 后端端口> [航迹 WS 端口]
# 第 4 个参数省略时与第 3 个相同（通用后端与航迹同源）。
#
# 可选环境变量:
#   APP_CONFIG_OUT  输出文件名（相对 nexus-ui/public/），默认 app-config.json（原地覆盖，旧行为）
#                   并行环境请设为 app-config.dev.json 或 app-config.prod.json

set -euo pipefail

ROOT="${1:?仓库根目录}"
HOST="${2:?主机（如 hostname -I 首地址）}"
HTTP_PORT="${3:?HTTP 后端端口}"
WS_PORT="${4:-$HTTP_PORT}"
OUT_NAME="${APP_CONFIG_OUT:-app-config.json}"

BASE_CFG="$ROOT/nexus-ui/public/app-config.json"
OUT_CFG="$ROOT/nexus-ui/public/$OUT_NAME"

if [[ ! -f "$BASE_CFG" ]]; then
  echo "错误: 缺少 $BASE_CFG" >&2
  exit 1
fi
cp "$BASE_CFG" "$OUT_CFG"
if command -v jq >/dev/null 2>&1; then
  tmp="$(mktemp)"
  jq --arg host "$HOST" --arg hp "$HTTP_PORT" --arg wp "$WS_PORT" '
    .websocket.url = ("ws://" + $host + ":" + $wp + "/ws") |
    .http.backendUrl = ("http://" + $host + ":" + $hp)
  ' "$OUT_CFG" > "$tmp"
  mv "$tmp" "$OUT_CFG" 2>/dev/null || { cat "$tmp" > "$OUT_CFG" && rm -f "$tmp"; }
elif command -v python3 >/dev/null 2>&1; then
  python3 - "$OUT_CFG" "$HOST" "$HTTP_PORT" "$WS_PORT" <<'PY'
import json, sys
path, host, hp, wp = sys.argv[1:5]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
data.setdefault("websocket", {})["url"] = f"ws://{host}:{wp}/ws"
data.setdefault("http", {})["backendUrl"] = f"http://{host}:{hp}"
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY
else
  echo "错误: 未找到 jq 或 python3" >&2
  exit 1
fi
echo "== app-config 网络端点已写入 ${OUT_NAME}: ws://${HOST}:${WS_PORT}/ws , http://${HOST}:${HTTP_PORT} =="
