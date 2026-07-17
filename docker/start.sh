#!/bin/bash
# 供 Fast DDS / c2_12 系镜像使用：挂载为 -v …/docker/start.sh:/start.sh
# 工作目录：/workspace = 本仓库根（含 nexus-ui、Custombackend）
set -e

echo "========================================"
echo "NexusUI 启动中（Docker / workspace）"
echo "========================================"

# Mode 2 ASR：浏览器 webm 需在容器内 ffmpeg 转 wav（宿主机有 ffmpeg 时 Next 进程仍跑在容器内）
ensure_ffmpeg() {
    if command -v ffmpeg >/dev/null 2>&1; then
        return 0
    fi
    if ! command -v apt-get >/dev/null 2>&1; then
        echo "⚠️ 容器内无 ffmpeg 且无法 apt-get：NEXUS_SPEECH_MODE=2 录音转写将失败"
        return 0
    fi
    echo "安装 ffmpeg（智能语音 Mode 2 转码需要，后台 apt，不阻塞 Custombackend）..."
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg
    if command -v ffmpeg >/dev/null 2>&1; then
        echo "✅ ffmpeg 已就绪: $(command -v ffmpeg)"
    else
        echo "⚠️ ffmpeg 安装失败：NEXUS_SPEECH_MODE=2 录音转写将失败"
    fi
}

schedule_ensure_ffmpeg() {
    if command -v ffmpeg >/dev/null 2>&1; then
        return 0
    fi
    ensure_ffmpeg &
    echo "⏳ ffmpeg 后台安装中（新容器首次约数分钟；Custombackend/Next 不等待）"
}

schedule_ensure_ffmpeg

BACKEND_PORT="${BACKEND_PORT:-27003}"
FRONTEND_PORT="${FRONTEND_PORT:-22301}"
export BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:${BACKEND_PORT}}"
export NEXT_PUBLIC_APP_CONFIG_URL="${NEXT_PUBLIC_APP_CONFIG_URL:-/app-config.json}"
export WATCHPACK_POLLING="${WATCHPACK_POLLING:-true}"
export PORT="${FRONTEND_PORT}"

has_prod_next_build() {
    [[ -f .next/BUILD_ID && -d .next/server ]]
}

clean_next_dev_cache() {
    if [[ ! -d .next ]]; then
        return 0
    fi
    if has_prod_next_build; then
        echo "清理 .next/dev（保留生产 .next/server 与 BUILD_ID，可与 prod 并行）..."
        if [[ -d .next/dev ]]; then
            rm -rf .next/dev 2>/dev/null || chmod -R a+rwX .next/dev 2>/dev/null && rm -rf .next/dev 2>/dev/null || {
                echo "⚠️ 无法删除 .next/dev，dev 可能遇到缓存权限问题" >&2
            }
        fi
        return 0
    fi
    clean_next_cache
}

clean_next_cache() {
    if [[ ! -d .next ]]; then
        return 0
    fi
    echo "清理 .next（避免 root/权限遗留导致 next dev EACCES）..."
    if rm -rf .next 2>/dev/null; then
        return 0
    fi
    chmod -R a+rwX .next 2>/dev/null || chown -R "$(id -u):$(id -g)" .next 2>/dev/null || true
    if rm -rf .next 2>/dev/null; then
        return 0
    fi
    local bak=".next.bak.$(date +%s)"
    echo "⚠️  rm 失败（文件可能被占用），重命名为 ${bak}..."
    if mv .next "$bak" 2>/dev/null; then
        rm -rf "$bak" 2>/dev/null &
        return 0
    fi
    echo "❌ 无法清理 .next。请停止占用容器后执行: mv nexus-ui/.next nexus-ui/.next.old && ./dev-start.sh" >&2
    return 1
}

free_tcp_port() {
    local p="$1"
    if ! ss -tln 2>/dev/null | grep -q ":${p}"; then
        return 0
    fi
    echo "端口 ${p} 已被占用，尝试结束监听进程（开发环境）..."
    if command -v fuser >/dev/null 2>&1; then
        fuser -k "${p}/tcp" 2>/dev/null || true
    elif command -v lsof >/dev/null 2>&1; then
        lsof -t -iTCP:"${p}" -sTCP:LISTEN 2>/dev/null | xargs -r kill -TERM 2>/dev/null || true
        sleep 0.2
        lsof -t -iTCP:"${p}" -sTCP:LISTEN 2>/dev/null | xargs -r kill -KILL 2>/dev/null || true
    else
        echo "❌ 未安装 fuser/lsof，无法自动释放端口 ${p}。"
        echo "   请手动: fuser -k ${p}/tcp 或换端口 FRONTEND_PORT=其他值 后重启容器。"
        return 1
    fi
    sleep 0.4
    if ss -tln 2>/dev/null | grep -q ":${p}"; then
        echo "❌ 端口 ${p} 仍被占用；访问该端口可能看到其它服务（如 FastAPI 的 {\"detail\":\"Not Found\"}）。"
        return 1
    fi
    echo "✅ 端口 ${p} 已释放"
}

ensure_grpc_deps() {
    if python3 -c "import grpc" 2>/dev/null; then
        return 0
    fi
    echo "安装 system-eval 所需 grpcio（requirements 子集）..."
    if ! python3 -m pip install -q grpcio==1.80.0 grpcio-tools==1.80.0 "protobuf>=6.31.1,<7"; then
        echo "⚠️ grpcio 安装失败，system-eval 等 gRPC 功能不可用" >&2
        return 1
    fi
    python3 -c "import grpc" 2>/dev/null && echo "✅ grpcio 已就绪"
}

_custombackend_prepare_deps() {
    cd /workspace/Custombackend
    PIP_PID=""
    if [[ "${NEXUS_PY_SKIP_INSTALL:-0}" == "1" ]]; then
        echo "跳过 pip install（NEXUS_PY_SKIP_INSTALL=1）"
        ensure_grpc_deps || true
    elif [[ "${NEXUS_PY_UPGRADE:-0}" == "1" ]]; then
        echo "安装/更新后端依赖（requirements.txt，后台，不阻塞 uvicorn）..."
        python3 -m pip install -q --upgrade -r requirements.txt &
        PIP_PID=$!
    else
        echo "安装/更新后端依赖（requirements.txt，后台，不阻塞 uvicorn）..."
        python3 -m pip install -q -r requirements.txt &
        PIP_PID=$!
    fi
    if [[ -n "${PIP_PID:-}" ]]; then
        if [[ "${NEXUS_PY_BLOCK_UVICORN:-0}" == "1" ]]; then
            echo "等待 Custombackend 依赖安装完成（pip install，阻塞 uvicorn）..."
            if ! wait "${PIP_PID}"; then
                echo "⚠️ pip install 失败，system-eval 等 gRPC 功能可能不可用"
            fi
        else
            echo "pip install 后台进行中，不阻塞 uvicorn 启动..."
            ( wait "${PIP_PID}" && echo "✅ Custombackend pip install 完成" || echo "⚠️ pip install 失败，system-eval 等 gRPC 功能可能不可用" ) &
        fi
    fi
}

_custombackend_export_fastdds_env() {
    if [[ -d /usr/local/eprosima/fastdds_python/lib/python3.10/site-packages ]]; then
      export PYTHONPATH="/opt/fastdds_python_ws/src/Fast-DDS-python/install/fastdds_python_examples/lib/python3.10/site-packages:/opt/fastdds_python_ws/src/Fast-DDS-python/install/fastdds_python/lib/python3.10/site-packages:/usr/local/eprosima/fastdds_python_examples/lib/python3.10/site-packages:/usr/local/eprosima/fastdds_python/lib/python3.10/site-packages${PYTHONPATH:+:$PYTHONPATH}"
      export LD_LIBRARY_PATH="/opt/fastdds_python_ws/src/Fast-DDS-python/install/fastdds_python_examples/lib:/usr/local/eprosima/fastdds/lib:/usr/local/eprosima/fastdds_python_examples/lib:/usr/local/eprosima/fastcdr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
      export PATH="/usr/local/eprosima/fastdds/bin:/usr/local/eprosima/foonathan_memory_vendor/bin:$PATH"
    fi
    # 勿将 NewTrackStruct/build 内 libfastdds 3.2 prepend 到 LD_LIBRARY_PATH：
    # Python fastdds 绑定链的是 3.1，混用会导致 domain 141 航迹 discovery 异常。
}

_custombackend_kill_stale() {
    pkill -f "python3 -m uvicorn main:app.*--port ${BACKEND_PORT}" 2>/dev/null || true
    sleep 0.3
    # uvicorn 崩溃后 DDS 航迹 multiprocessing 子进程可能变成孤儿，重启前清理
    pkill -f "python3 -c from multiprocessing.spawn import spawn_main" 2>/dev/null || true
    sleep 0.2
    if [[ "${NEXUS_DOCKER_NO_KILL:-0}" != "1" ]]; then
        free_tcp_port "${BACKEND_PORT}" || true
    fi
}

_custombackend_watchdog_loop() {
    local delay="${NEXUS_BACKEND_RESTART_DELAY_SEC:-5}"
    while true; do
        _custombackend_kill_stale
        echo "[custombackend-watchdog] 启动 uvicorn :${BACKEND_PORT} ..."
        cd /workspace/Custombackend/app
        python3 -m uvicorn main:app --host 0.0.0.0 --port "${BACKEND_PORT}" &
        local pid=$!
        wait "$pid" 2>/dev/null || true
        local ec=$?
        echo "[custombackend-watchdog] uvicorn 退出 (pid=${pid}, code=${ec})"
        pkill -P "$pid" 2>/dev/null || true
        sleep 0.5
        pkill -P "$pid" -KILL 2>/dev/null || true
        _custombackend_kill_stale
        echo "[custombackend-watchdog] ${delay}s 后重启..."
        sleep "$delay"
    done
}

start_custombackend() {
    echo "启动 Custombackend（端口 ${BACKEND_PORT}）..."
    _custombackend_prepare_deps
    _custombackend_export_fastdds_env
    if [[ "${NEXUS_BACKEND_NO_WATCHDOG:-0}" == "1" ]]; then
        _custombackend_kill_stale
        cd /workspace/Custombackend/app
        python3 -m uvicorn main:app --host 0.0.0.0 --port "${BACKEND_PORT}" &
        echo "✅ Custombackend 已后台启动（NEXUS_BACKEND_NO_WATCHDOG=1，无守护）"
    else
        _custombackend_watchdog_loop &
        echo "✅ Custombackend 守护已启动（端口 ${BACKEND_PORT}，崩溃后自动重启）"
    fi
}

if [[ "${BACKEND_ONLY:-0}" == "1" ]]; then
    echo "BACKEND_ONLY=1：跳过 nexus-ui，仅挂载运行 Custombackend（便于 DDS 调试）"
elif [ "$DEV_MODE" = "1" ]; then
    echo "开发模式：nexus-ui + Custombackend"
    cd /workspace/nexus-ui
    echo "[nexus-ui dev] NEXT_PUBLIC_APP_CONFIG_URL=${NEXT_PUBLIC_APP_CONFIG_URL}"
    echo "[nexus-ui dev] NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=${NEXT_PUBLIC_WS_USE_NGINX_TUNNEL:-}"
    echo "[nexus-ui dev] NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT=${NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT:-}"
    if [[ "${NEXUS_UI_CLEAN_NEXT:-0}" == "1" ]]; then
        echo "（--rebuild：清理整个 .next）"
        clean_next_cache || exit 1
    else
        clean_next_dev_cache || exit 1
    fi
    if [[ "${NEXUS_UI_CLEAN_NEXT:-0}" == "1" ]]; then
        echo "（--rebuild 已额外清理 node_modules 缓存由 npm install 刷新）"
    fi
    echo "安装/更新前端依赖（npm install）..."
    npm install
    if [[ "${NEXUS_DOCKER_NO_KILL:-0}" != "1" ]]; then
        free_tcp_port "${FRONTEND_PORT}" || true
    fi
    if ss -tln 2>/dev/null | grep -q ":${FRONTEND_PORT}"; then
        echo "❌ TCP ${FRONTEND_PORT} 仍被占用，已跳过 Next。请释放端口或设置 FRONTEND_PORT 后重建容器。"
    else
        echo "启动前端开发（HTTPS，PORT=${FRONTEND_PORT}，自签证书）..."
        npm run dev &
        echo "✅ 已发起 Next 后台启动（数秒后可用 curl -skI https://127.0.0.1:${FRONTEND_PORT}/ 自检，-k 忽略自签）"
    fi
else
    echo "生产模式：构建前端并以 next start 运行"
    start_custombackend
    cd /workspace/nexus-ui
    if [[ "${NEXUS_UI_CLEAN_NEXT:-0}" == "1" ]]; then
        echo "生产重构：清理 Next 缓存 (.next)..."
        clean_next_cache || exit 1
    fi
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    if [[ "${NEXUS_DOCKER_NO_KILL:-0}" != "1" ]]; then
        free_tcp_port "${FRONTEND_PORT}" || true
    fi
    if ss -tln 2>/dev/null | grep -q ":${FRONTEND_PORT}"; then
        echo "❌ TCP ${FRONTEND_PORT} 仍被占用，已跳过 next start。"
    else
        echo "[nexus-ui] 构建时将固化 NEXT_PUBLIC_*（须由 docker run -e 或 nexus-ui/.env.local 提供）"
        echo "[nexus-ui] NEXT_PUBLIC_APP_CONFIG_URL=${NEXT_PUBLIC_APP_CONFIG_URL}"
        echo "[nexus-ui] NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=${NEXT_PUBLIC_WS_USE_NGINX_TUNNEL:-}"
        echo "[nexus-ui] NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT=${NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT:-}"
    if [[ "${NEXUS_UI_SKIP_BUILD:-0}" == "1" && -f .next/BUILD_ID && -d .next/server ]]; then
            echo "跳过 npm run build（NEXUS_UI_SKIP_BUILD=1 且已有生产 .next；改 NEXT_PUBLIC_* 请 --rebuild）"
        else
            if [[ "${NEXUS_UI_SKIP_BUILD:-0}" == "1" ]]; then
                echo "⚠️ 未检测到完整生产 .next（需 .next/BUILD_ID 与 .next/server/；可能与 dev 共用目录冲突），执行 npm run build..."
            fi
            npm run build
        fi
        npm run start &
    fi
fi

if [[ "${BACKEND_ONLY:-0}" == "1" ]] || [ "$DEV_MODE" = "1" ]; then
    start_custombackend
fi

echo "========================================"
if [ "$DEV_MODE" = "1" ]; then
    echo "前端: https://<宿主机>:${FRONTEND_PORT} （开发证书为自签，浏览器需「继续访问」）"
else
    echo "前端: http://<宿主机>:${FRONTEND_PORT} （next start，生产 HTTP）"
fi
echo "Custombackend HTTP/WS: http://<宿主机>:${BACKEND_PORT} （WebSocket: /ws）"
echo "========================================"

tail -f /dev/null
