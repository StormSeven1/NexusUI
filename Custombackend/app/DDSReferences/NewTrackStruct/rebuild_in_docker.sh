#!/usr/bin/env bash
# 在 xk_docker 内：fastddsgen + cmake，生成与 Python fastdds(3.1) 一致的 SWIG 绑定。
# Custombackend 侧 IDL 模块名须为 TargetFull（与 TrackManager 发布端 DDS 类型名一致）。
set -euo pipefail
CONTAINER="${NEXUS_DOCKER_NAME:-xk_docker}"
SRC="/workspace/Custombackend/app/DDSReferences/NewTrackStruct"

docker exec "$CONTAINER" bash -c "
set -e
export LD_LIBRARY_PATH=/usr/local/eprosima/fastdds/lib:/usr/local/eprosima/fastcdr/lib
cd '${SRC}'
fastddsgen -replace -python NewTrackRealTimeStatus.idl
rm -rf build && mkdir build && cd build
cmake .. -DCMAKE_PREFIX_PATH='/usr/local/eprosima/fastdds;/usr/local/eprosima/fastcdr;/usr/local/eprosima/foonathan_memory_vendor'
make -j\$(nproc)
ldd _NewTrackRealTimeStatusWrapper.so | grep -E 'fastdds|fastcdr'
export PYTHONPATH=/usr/local/eprosima/fastdds_python/lib/python3.10/site-packages
python3 -c \"import sys; sys.path.insert(0,'.'); import NewTrackRealTimeStatus as m; print('type=', m.TargetOutputSetPubSubType().get_name())\"
"
echo "完成。请 ./dev-start.sh 重启开发环境。"
