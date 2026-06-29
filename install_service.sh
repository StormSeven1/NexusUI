#!/usr/bin/env bash
# 安装 NexusUI 生产 systemd 服务（开机自启；容器崩溃由 Docker --restart unless-stopped 拉起）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="nexusui-prod.service"
UNIT_SRC="${ROOT}/${SERVICE_NAME}"
UNIT_DST="/etc/systemd/system/${SERVICE_NAME}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 root 执行: sudo $0" >&2
  exit 1
fi

resolve_service_user() {
  if [[ -n "${SERVICE_USER:-}" ]]; then
    echo "${SERVICE_USER}"
    return
  fi
  if getent passwd dell &>/dev/null; then
    echo dell
    return
  fi
  echo root
}

SVC_USER="$(resolve_service_user)"
SVC_GROUP="${SERVICE_GROUP:-${SVC_USER}}"

if ! getent group "${SVC_GROUP}" &>/dev/null; then
  echo "[error] 组不存在: ${SVC_GROUP}" >&2
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "[error] 未找到 docker" >&2
  exit 1
fi

IMG="${NEXUS_DOCKER_IMAGE:-xk_docker:latest}"
if ! docker image inspect "$IMG" >/dev/null 2>&1; then
  echo "[error] 缺少镜像 ${IMG}，请先 docker load 或构建" >&2
  exit 1
fi

chmod +x "${ROOT}/scripts/prod-service.sh" \
  "${ROOT}/prod-start-nginx.sh" "${ROOT}/prod-start.sh" \
  "${ROOT}/docker/start.sh" 2>/dev/null || true

echo "==> 安装 unit: ${UNIT_DST}（User=${SVC_USER}）"
sed -e "s|__INSTALL_ROOT__|${ROOT}|g" \
    -e "s|__SERVICE_USER__|${SVC_USER}|g" \
    -e "s|__SERVICE_GROUP__|${SVC_GROUP}|g" \
    "${UNIT_SRC}" >"${UNIT_DST}"
chmod 644 "${UNIT_DST}"

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "==> 状态:"
systemctl --no-pager status "${SERVICE_NAME}" || true
echo ""
echo "常用命令:"
echo "  sudo systemctl status ${SERVICE_NAME}"
echo "  sudo journalctl -u ${SERVICE_NAME} -f"
echo "  sudo systemctl restart ${SERVICE_NAME}"
echo "  docker ps --filter name=xk_"
