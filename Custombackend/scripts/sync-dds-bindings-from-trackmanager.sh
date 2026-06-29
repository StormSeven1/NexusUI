#!/usr/bin/env bash
# 将 trackmanager 容器内已编译的 SWIG 绑定同步到 Custombackend，避免 TypeObject 不一致导致 domain141 只 matched 虚兵发布端。
set -euo pipefail
TM="${TRACKMANAGER_CONTAINER:-trackmanager}"
UI="${NEXUS_DOCKER_NAME:-xk_docker}"
ROOT="$(cd "$(dirname "$0")/../app" && pwd)"

copy_module() {
  local remote_dir="$1"
  local local_dir="$2"
  mkdir -p "$local_dir"
  for f in lib*.so _*Wrapper.so *.py; do
    docker cp "${TM}:${remote_dir}/${f}" "${local_dir}/" 2>/dev/null || true
  done
  echo "synced ${local_dir}"
}

copy_module /workspace/New/DDSReferences/NewTrackStruct/build "${ROOT}/DDSReferences/NewTrackStruct/build"
copy_module /workspace/New/DDSReferences/fusion "${ROOT}/DDSReferences/fusion"

echo "完成。请在 141 上重启开发环境: ./dev-start.sh（或重启 xk_docker 内 uvicorn）"
