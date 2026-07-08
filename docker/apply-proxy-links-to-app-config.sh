#!/usr/bin/env bash
# 按 SITE_MODE 写入 app-config.*.json 的 softwareCompositionLinks（顶栏「软件组成」）
# - daily：UPSTREAM 主机/端口（219xx 等）+ app-config.json 保留路径
# - demo：SITE_LAN_HOST + DEMO_PORT（253xx）+ 同上路径
#
# 用法: apply-proxy-links-to-app-config.sh <NexusUI根目录>

set -euo pipefail

ROOT="${1:?NexusUI 根目录}"
BASE_CFG="$ROOT/nexus-ui/public/app-config.json"
SVC_FILE="$ROOT/site-proxy-services.env"
MODE_FILE="$ROOT/site-mode.env"
HOST_FILE="$ROOT/site-host.env"

[[ -f "$BASE_CFG" ]] || { echo "错误: 缺少 $BASE_CFG" >&2; exit 1; }
[[ -f "$SVC_FILE" ]] || { echo "跳过 softwareCompositionLinks（无 $SVC_FILE）"; exit 0; }

SITE_MODE="daily"
[[ -f "$MODE_FILE" ]] && SITE_MODE="$(grep -E '^SITE_MODE=' "$MODE_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
SITE_MODE="${SITE_MODE:-daily}"

SITE_LAN_HOST=""
[[ -f "$HOST_FILE" ]] && SITE_LAN_HOST="$(grep -E '^SITE_LAN_HOST=' "$HOST_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
[[ -n "$SITE_LAN_HOST" ]] || SITE_LAN_HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ -n "$SITE_LAN_HOST" ]] || SITE_LAN_HOST="127.0.0.1"

OUT_CFGS=()
for name in app-config.prod.json app-config.dev.json; do
  f="$ROOT/nexus-ui/public/$name"
  [[ -f "$f" ]] && OUT_CFGS+=("$f")
done
[[ ${#OUT_CFGS[@]} -gt 0 ]] || {
  echo "错误: 缺少 app-config.prod.json / app-config.dev.json（请先 prod-start / dev-start）" >&2
  exit 1
}

apply_one() {
  local out_cfg="$1"
  python3 - "$BASE_CFG" "$out_cfg" "$SVC_FILE" "$SITE_MODE" "$SITE_LAN_HOST" <<'PY'
import json, pathlib, re, sys
from urllib.parse import urlparse, urlunparse

base_path, out_path, svc_path, site_mode, lan_host = sys.argv[1:6]
base = json.loads(pathlib.Path(base_path).read_text(encoding="utf-8"))
out = json.loads(pathlib.Path(out_path).read_text(encoding="utf-8"))
daily_links = base.get("softwareCompositionLinks") or []

proxy_by_id: dict[str, dict] = {}
for line in pathlib.Path(svc_path).read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    m = re.match(
        r"^PROXY_SVC_([A-Z0-9]+)_(ENABLED|LABEL|DEMO_PORT|SCHEME|TYPE|UPSTREAM)=(.*)$",
        line,
    )
    if not m:
        continue
    sid, key, val = m.group(1), m.group(2), m.group(3).strip()
    proxy_by_id.setdefault(sid, {})
    proxy_by_id[sid][key] = val

label_map: dict[str, dict] = {}
for sid, cfg in proxy_by_id.items():
    if cfg.get("TYPE") == "gateway":
        continue
    if str(cfg.get("ENABLED", "")).lower() not in ("1", "true", "yes", "on"):
        continue
    upstream = (cfg.get("UPSTREAM") or "").strip()
    if not upstream:
        continue
    label = cfg.get("LABEL", sid)
    try:
        demo_port = int(cfg.get("DEMO_PORT", "0"))
    except ValueError:
        demo_port = 0
    scheme = (cfg.get("SCHEME") or "http").lower()
    label_map[label] = {
        "upstream": upstream,
        "demo_port": demo_port,
        "scheme": scheme,
    }


def link_path(daily: str) -> str:
    u = urlparse(daily)
    path = u.path or "/"
    if u.query:
        path = f"{path}?{u.query}"
    return path


def daily_url_from_upstream(upstream: str, path: str) -> str:
    u = urlparse(upstream)
    scheme = u.scheme or "http"
    netloc = u.netloc
    return urlunparse((scheme, netloc, path, "", "", ""))


def demo_url_from_path(path: str, demo_port: int, scheme: str) -> str:
    netloc = f"{lan_host}:{demo_port}"
    return urlunparse((scheme, netloc, path, "", "", ""))


new_links = []
for link in daily_links:
    if not isinstance(link, dict):
        continue
    label = str(link.get("label") or "").strip()
    daily = str(link.get("url") or "").strip()
    url = daily
    if label in label_map and daily:
        cfg = label_map[label]
        path = link_path(daily)
        if site_mode == "demo" and cfg["demo_port"] > 0:
            url = demo_url_from_path(path, cfg["demo_port"], cfg["scheme"])
        else:
            url = daily_url_from_upstream(cfg["upstream"], path)
    new_links.append({"label": label, "url": url})

out["softwareCompositionLinks"] = new_links
pathlib.Path(out_path).write_text(
    json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
mode_zh = "演示" if site_mode == "demo" else "日常"
print(f"== {pathlib.Path(out_path).name} softwareCompositionLinks（{mode_zh}，{len(new_links)} 项）==")
for item in new_links:
    print(f"   {item['label']}: {item['url']}")
PY
}

for out_cfg in "${OUT_CFGS[@]}"; do
  apply_one "$out_cfg"
done
