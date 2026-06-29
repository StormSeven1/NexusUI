#!/usr/bin/env bash
# 按 SITE_MODE 写入 app-config.prod.json 的 softwareCompositionLinks（顶栏「软件组成」）
# - daily：与 app-config.json 日常直连 URL 一致
# - demo：同路径改走 site-proxy-services.env 的 DEMO_PORT（Nginx 演示端口）
#
# 用法: apply-proxy-links-to-app-config.sh <NexusUI根目录>

set -euo pipefail

ROOT="${1:?NexusUI 根目录}"
BASE_CFG="$ROOT/nexus-ui/public/app-config.json"
OUT_CFG="$ROOT/nexus-ui/public/app-config.prod.json"
SVC_FILE="$ROOT/site-proxy-services.env"
MODE_FILE="$ROOT/site-mode.env"
HOST_FILE="$ROOT/site-host.env"

[[ -f "$BASE_CFG" ]] || { echo "错误: 缺少 $BASE_CFG" >&2; exit 1; }
[[ -f "$OUT_CFG" ]] || { echo "错误: 缺少 $OUT_CFG（请先 prod-start / apply-app-config-endpoints）" >&2; exit 1; }
[[ -f "$SVC_FILE" ]] || { echo "跳过 softwareCompositionLinks（无 $SVC_FILE）"; exit 0; }

SITE_MODE="daily"
[[ -f "$MODE_FILE" ]] && SITE_MODE="$(grep -E '^SITE_MODE=' "$MODE_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
SITE_MODE="${SITE_MODE:-daily}"

SITE_LAN_HOST=""
[[ -f "$HOST_FILE" ]] && SITE_LAN_HOST="$(grep -E '^SITE_LAN_HOST=' "$HOST_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
[[ -n "$SITE_LAN_HOST" ]] || SITE_LAN_HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ -n "$SITE_LAN_HOST" ]] || SITE_LAN_HOST="127.0.0.1"

python3 - "$BASE_CFG" "$OUT_CFG" "$SVC_FILE" "$SITE_MODE" "$SITE_LAN_HOST" <<'PY'
import json, pathlib, re, sys
from urllib.parse import urlparse, urlunparse

base_path, out_path, svc_path, site_mode, lan_host = sys.argv[1:6]
base = json.loads(pathlib.Path(base_path).read_text(encoding="utf-8"))
out = json.loads(pathlib.Path(out_path).read_text(encoding="utf-8"))
daily_links = base.get("softwareCompositionLinks") or []

# 解析 site-proxy-services.env → label -> {demo_port, scheme}
proxy_by_label: dict[str, dict] = {}
for line in pathlib.Path(svc_path).read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    m = re.match(r"^PROXY_SVC_([A-Z0-9]+)_(ENABLED|LABEL|DEMO_PORT|SCHEME|TYPE)=(.*)$", line)
    if not m:
        continue
    sid, key, val = m.group(1), m.group(2), m.group(3).strip()
    proxy_by_label.setdefault(sid, {})
    proxy_by_label[sid][key] = val

label_map: dict[str, dict] = {}
for sid, cfg in proxy_by_label.items():
    if cfg.get("TYPE") == "gateway":
        continue
    if str(cfg.get("ENABLED", "")).lower() not in ("1", "true", "yes", "on"):
        continue
    label = cfg.get("LABEL", sid)
    try:
        demo_port = int(cfg.get("DEMO_PORT", "0"))
    except ValueError:
        demo_port = 0
    scheme = (cfg.get("SCHEME") or "http").lower()
    if demo_port > 0:
        label_map[label] = {"demo_port": demo_port, "scheme": scheme}

def daily_url(link: dict) -> str:
    return str(link.get("url") or "").strip()

def demo_url_from_daily(daily: str, demo_port: int, scheme: str) -> str:
    u = urlparse(daily)
    path = u.path or "/"
    if u.query:
        path = f"{path}?{u.query}"
    netloc = f"{lan_host}:{demo_port}"
    return urlunparse((scheme, netloc, path, "", "", ""))

new_links = []
for link in daily_links:
    if not isinstance(link, dict):
        continue
    label = str(link.get("label") or "").strip()
    daily = daily_url(link)
    url = daily
    if site_mode == "demo" and label in label_map and daily:
        p = label_map[label]
        url = demo_url_from_daily(daily, p["demo_port"], p["scheme"])
    new_links.append({"label": label, "url": url})

out["softwareCompositionLinks"] = new_links
pathlib.Path(out_path).write_text(
    json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
mode_zh = "演示" if site_mode == "demo" else "日常"
print(f"== softwareCompositionLinks 已写入 app-config.prod.json（{mode_zh}，{len(new_links)} 项）==")
for item in new_links:
    print(f"   {item['label']}: {item['url']}")
PY
