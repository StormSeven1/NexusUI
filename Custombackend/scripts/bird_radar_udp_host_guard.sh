#!/usr/bin/env bash
# 宿主机守护：CustomBackend（Docker）在探鸟采集 start 时写触发文件，本进程释放 UDP 8001。
#
# 用法（在 18.141 宿主机，不要放进容器内跑 kill）:
#   chmod +x Custombackend/scripts/bird_radar_udp_host_guard.sh
#   nohup ./Custombackend/scripts/bird_radar_udp_host_guard.sh >> /tmp/bird_radar_udp_guard.log 2>&1 &
#
# 或由仓库根启动（幂等）:
#   ./Custombackend/scripts/bird_radar_udp_host_guard.sh --daemon

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_DIR="${ROOT}/Custombackend/app/data/radar_train_captures"
TRIGGER="${DATA_DIR}/.request_free_udp_8001"
DONE="${DATA_DIR}/.free_udp_8001_done"
PORT="${BIRD_RADAR_UDP_PORT:-8001}"

mkdir -p "$DATA_DIR"

free_udp() {
  local port="$1"
  echo "[$(date '+%F %T')] free UDP ${port}"

  # 优先按端口杀（探鸟 start.py / 其它占用者）
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/udp" 2>/dev/null || true
  fi

  # 再按 cmdline 兜底（Predictdy / for_uav_recognition 下的 start.py）
  if command -v pgrep >/dev/null 2>&1; then
    while read -r pid; do
      [[ -n "${pid}" ]] || continue
      cmd="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
      echo "  kill pid=${pid} cmd=${cmd}"
      kill -TERM "${pid}" 2>/dev/null || true
      sleep 0.3
      kill -KILL "${pid}" 2>/dev/null || true
    done < <(pgrep -f 'for_uav_recognition|Predictdy.*start\.py|python.*start\.py' 2>/dev/null || true)
  fi

  # 仅杀确认仍占用该 UDP 端口的 python
  if command -v ss >/dev/null 2>&1; then
    ss -ulnp 2>/dev/null | grep -E ":${port}\\b" || echo "  ss: :${port} 已空闲或无进程信息"
  fi

  date '+%s' >"${DONE}"
  rm -f "${TRIGGER}"
  echo "[$(date '+%F %T')] done → ${DONE}"
}

loop() {
  echo "[$(date '+%F %T')] bird_radar_udp_host_guard watching ${TRIGGER} (port=${PORT})"
  while true; do
    if [[ -f "${TRIGGER}" ]]; then
      port="$(head -n1 "${TRIGGER}" 2>/dev/null | tr -cd '0-9' || true)"
      [[ -n "${port}" ]] || port="${PORT}"
      free_udp "${port}"
    fi
    sleep 0.4
  done
}

if [[ "${1:-}" == "--daemon" ]]; then
  # 若已有实例则退出
  if pgrep -f 'bird_radar_udp_host_guard\.sh' >/dev/null 2>&1; then
    # 排除自身
    self=$$
    others="$(pgrep -f 'bird_radar_udp_host_guard\.sh' | grep -v "^${self}$" || true)"
    if [[ -n "${others}" ]]; then
      echo "already running: ${others}"
      exit 0
    fi
  fi
  nohup "$0" >>/tmp/bird_radar_udp_guard.log 2>&1 &
  echo "started pid=$! log=/tmp/bird_radar_udp_guard.log"
  exit 0
fi

loop
