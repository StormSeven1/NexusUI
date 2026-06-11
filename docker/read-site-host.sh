#!/usr/bin/env bash
# 读取仓库根 site-host.env 中的 SITE_LAN_HOST
# 用法: source docker/read-site-host.sh && read_site_lan_host "$ROOT"
read_site_lan_host() {
  local root="${1:?仓库根目录}"
  local f="$root/site-host.env"
  SITE_LAN_HOST=""
  if [[ -f "$f" ]]; then
    # shellcheck disable=SC1090
    source "$f"
  fi
  printf '%s' "${SITE_LAN_HOST:-}"
}
