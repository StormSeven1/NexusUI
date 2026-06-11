#!/usr/bin/env bash
# 将 NewTrackStruct（Fast DDS 3.2）运行时依赖复制到 build/，供 Docker 等仅有 Fast DDS 3.1 的环境加载。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD="${ROOT}/build"
FASTDDS3_LIB="${FASTDDS3_LIB:-/usr/local/fastdds3/lib}"

mkdir -p "${BUILD}"

copy_if() {
  local src="$1"
  if [[ -e "${src}" ]]; then
    cp -a "${src}" "${BUILD}/"
    echo "  + $(basename "${src}")"
  fi
}

echo "== sync NewTrackStruct runtime libs -> ${BUILD} =="

if [[ -d "${FASTDDS3_LIB}" ]]; then
  copy_if "${FASTDDS3_LIB}/libfastdds.so.3.2"
  copy_if "${FASTDDS3_LIB}/libfastdds.so.3.2.2"
  copy_if "${FASTDDS3_LIB}/libfastcdr.so.2"
  copy_if "${FASTDDS3_LIB}/libfastcdr.so.2.3.0"
else
  echo "警告: 未找到 ${FASTDDS3_LIB}，跳过 libfastdds/libfastcdr"
fi

# fastdds 3.2 在较新 Ubuntu 上链 tinyxml2.so.6 / openssl 1.1；部分 Docker 镜像只有 .so.9 / openssl 3
for lib in /lib/x86_64-linux-gnu/libtinyxml2.so.6* \
           /lib/x86_64-linux-gnu/libssl.so.1.1 \
           /lib/x86_64-linux-gnu/libcrypto.so.1.1; do
  copy_if "${lib}"
done

echo "完成。Docker 启动时 start.sh 会把 build/ 加入 LD_LIBRARY_PATH。"
