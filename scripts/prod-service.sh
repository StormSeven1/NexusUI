#!/usr/bin/env bash
# NexusUI 生产 systemd 用：启动/停止 prod-start-nginx（Docker 容器自带 --restart unless-stopped）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  echo "用法: $0 start|stop" >&2
  exit 1
}

case "${1:-}" in
  start)
    chmod +x "$ROOT/prod-start-nginx.sh" "$ROOT/prod-start.sh" 2>/dev/null || true
    exec env NGINX_IMAGE=nginx:alpine "$ROOT/prod-start-nginx.sh" --no-build --restart
    ;;
  stop)
    docker rm -f xk_nginx_prod xk_docker_prod 2>/dev/null || true
    ;;
  *)
    usage
    ;;
esac
