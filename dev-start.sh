#!/usr/bin/env bash
# NexusUI 开发环境一键启动：Docker 检查 → 挂载仓库起容器 → 容器内执行 docker/start.sh（前后端 + 依赖更新）
#
# 用法（在仓库根 NexusUI/）:
#   chmod +x dev-start.sh   # 首次
#   ./dev-start.sh
#   ./dev-start.sh --pull     # 启动前 git pull --ff-only（需 .git）
#   ./dev-start.sh --rebuild  # 容器内删 nexus-ui/.next、npm install，后端 pip install --upgrade
#
# 环境变量（可选）:
#   NEXUS_DOCKER_IMAGE   默认 xk_docker:latest
#   NEXUS_DOCKER_NAME    默认 xk_docker
#   BACKEND_PORT         默认 27003
#   FRONTEND_PORT        默认 22301（与 nexus-ui/.env.local 中 PORT 一致为宜）
#   FRONTEND_HTTPS_SAN_IP  可选，写入 dev 证书 SAN；默认取 nexus-ui/next.config.ts allowedDevOrigins 首项
#   BACKEND_URL          默认 http://127.0.0.1:${BACKEND_PORT}
#   BACKEND_ONLY=1       仅起 Custombackend
#   NEXUS_DOCKER_NO_KILL=1  不尝试 fuser 释放 FRONTEND_PORT

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DO_GIT_PULL=0
DO_REBUILD=0
for a in "$@"; do
  case "$a" in
    --pull) DO_GIT_PULL=1 ;;
    --rebuild) DO_REBUILD=1 ;;
    -h|--help)
      echo "用法: $0 [--pull] [--rebuild]"
      echo "  --pull     在 $ROOT 执行 git pull --ff-only（需为 git 仓库）"
      echo "  --rebuild  清理前端 .next 并升级 pip 依赖（大改依赖时用）"
      exit 0
      ;;
    *)
      echo "未知参数: $a （$0 -h）" >&2
      exit 1
      ;;
  esac
done

IMG="${NEXUS_DOCKER_IMAGE:-xk_docker:latest}"
NAME="${NEXUS_DOCKER_NAME:-xk_docker}"
BP="${BACKEND_PORT:-27003}"
FP="${FRONTEND_PORT:-22301}"
BU="${BACKEND_URL:-http://127.0.0.1:${BP}}"

# 用 https://<局域网IP> 打开前端时，证书 SAN 须含该 IP。未设置则取 nexus-ui/next.config.ts 里 allowedDevOrigins 的首项。
if [[ -z "${FRONTEND_HTTPS_SAN_IP:-}" ]] && [[ -f "$ROOT/nexus-ui/next.config.ts" ]]; then
  FRONTEND_HTTPS_SAN_IP="$(sed -n 's/.*allowedDevOrigins:[[:space:]]*\["\([^"]*\)"\].*/\1/p' "$ROOT/nexus-ui/next.config.ts" | head -1)"
fi

echo "== NexusUI dev-start =="
echo "仓库: $ROOT"
echo "镜像: $IMG | 容器名: $NAME | 后端端口: $BP | 前端端口: $FP"
if [[ -n "${FRONTEND_HTTPS_SAN_IP:-}" ]]; then
  echo "前端 HTTPS 证书 SAN 含 IP: ${FRONTEND_HTTPS_SAN_IP} （可覆盖: FRONTEND_HTTPS_SAN_IP=其他IP 逗号分隔）"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "错误: 未找到 docker 命令，请先安装 Docker。" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "错误: Docker 守护进程未运行或当前用户无权限（试试 sudo 或加入 docker 组）。" >&2
  exit 1
fi

if ! docker image inspect "$IMG" >/dev/null 2>&1; then
  echo "错误: 本地不存在镜像 $IMG" >&2
  echo "请先构建或拉取，或设置 NEXUS_DOCKER_IMAGE=你的镜像:tag" >&2
  exit 1
fi

if [[ "$DO_GIT_PULL" -eq 1 ]]; then
  if [[ -d "$ROOT/.git" ]]; then
    echo "== git pull --ff-only =="
    git -C "$ROOT" pull --ff-only
  else
    echo "跳过 git pull：$ROOT 不是 git 仓库"
  fi
fi

START_SH="$ROOT/docker/start.sh"
if [[ ! -f "$START_SH" ]]; then
  echo "错误: 未找到 $START_SH（请保留仓库内 docker/start.sh）" >&2
  exit 1
fi
chmod +x "$START_SH" 2>/dev/null || true

echo "== 重建容器并挂载 /workspace =="
docker rm -f "$NAME" 2>/dev/null || true

if [[ "$DO_REBUILD" -eq 1 ]]; then
  echo "== --rebuild：将清理 nexus-ui/.next 并在容器内刷新依赖 =="
fi

docker run -d \
  --name "$NAME" \
  --network host \
  --cgroupns=host \
  -e DEV_MODE=1 \
  -e TZ=Asia/Shanghai \
  -e "EPROSIMA_IMAGE=Fast DDS" \
  -e DEBIAN_FRONTEND=noninteractive \
  -e "BACKEND_PORT=${BP}" \
  -e "FRONTEND_PORT=${FP}" \
  -e "FRONTEND_HTTPS_SAN_IP=${FRONTEND_HTTPS_SAN_IP:-}" \
  -e "BACKEND_URL=${BU}" \
  -e "BACKEND_ONLY=${BACKEND_ONLY:-0}" \
  -e "NEXUS_DOCKER_NO_KILL=${NEXUS_DOCKER_NO_KILL:-0}" \
  -e "NEXUS_UI_CLEAN_NEXT=${DO_REBUILD}" \
  -e "NEXUS_PY_UPGRADE=${DO_REBUILD}" \
  -v "${ROOT}:/workspace" \
  -v "${START_SH}:/start.sh:ro" \
  --shm-size=64m \
  --entrypoint /bin/bash \
  "$IMG" \
  -c 'set -e; chmod +x /start.sh 2>/dev/null || true; exec /start.sh'

sleep 2
running="$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null || echo false)"
if [[ "$running" != "true" ]]; then
  echo "错误: 容器 ${NAME} 未在运行或已退出。最近日志:" >&2
  docker logs "$NAME" 2>&1 | tail -100 >&2 || true
  exit 1
fi

echo ""
echo "已启动容器: $NAME"
echo "  前端:     https://127.0.0.1:${FP}  （自签证书；局域网用本机 IP:${FP}）"
echo "  后端 API: http://127.0.0.1:${BP}/api  WebSocket: ws://127.0.0.1:${BP}/ws"
echo ""
echo "说明: 开发模式下每次启动会 npm install、pip install，并拉起 next dev（HTTPS）与 uvicorn。"
echo "      若必须用 HTTP 前端，可在容器内 cd /workspace/nexus-ui && npm run dev:http"
echo "查看日志: docker logs -f ${NAME}"
echo "进入容器: docker exec -it ${NAME} bash"
echo "停止容器: docker rm -f ${NAME}"
