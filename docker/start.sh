#!/bin/bash
# 供 Fast DDS / c2_12 系镜像使用：挂载为 -v …/docker/start.sh:/start.sh
# 工作目录：/workspace = 本仓库根（含 nexus-ui、Custombackend）
set -e

echo "========================================"
echo "NexusUI 启动中（Docker / workspace）"
echo "========================================"

BACKEND_PORT="${BACKEND_PORT:-27003}"
FRONTEND_PORT="${FRONTEND_PORT:-22301}"
export BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:${BACKEND_PORT}}"
export NEXT_PUBLIC_APP_CONFIG_URL="${NEXT_PUBLIC_APP_CONFIG_URL:-/app-config.json}"
export WATCHPACK_POLLING="${WATCHPACK_POLLING:-true}"
export PORT="${FRONTEND_PORT}"

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

if [[ "${BACKEND_ONLY:-0}" == "1" ]]; then
    echo "BACKEND_ONLY=1：跳过 nexus-ui，仅挂载运行 Custombackend（便于 DDS 调试）"
elif [ "$DEV_MODE" = "1" ]; then
    echo "开发模式：nexus-ui + Custombackend"
    cd /workspace/nexus-ui
    echo "[nexus-ui dev] NEXT_PUBLIC_APP_CONFIG_URL=${NEXT_PUBLIC_APP_CONFIG_URL}"
    echo "[nexus-ui dev] NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=${NEXT_PUBLIC_WS_USE_NGINX_TUNNEL:-}"
    echo "[nexus-ui dev] NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT=${NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT:-}"
    if [[ "${NEXUS_UI_CLEAN_NEXT:-0}" == "1" ]]; then
        echo "重构前端：清理 Next 缓存 (.next)..."
        rm -rf .next
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
    cd /workspace/nexus-ui
    if [[ "${NEXUS_UI_CLEAN_NEXT:-0}" == "1" ]]; then
        echo "生产重构：清理 Next 缓存 (.next)..."
        rm -rf .next
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
        npm run build
        npm run start &
    fi
fi

echo "启动 Custombackend（端口 ${BACKEND_PORT}）..."
cd /workspace/Custombackend
PIP_PID=""
if [[ "${NEXUS_PY_SKIP_INSTALL:-0}" == "1" ]]; then
    echo "跳过 pip install（NEXUS_PY_SKIP_INSTALL=1）"
elif [[ "${NEXUS_PY_UPGRADE:-0}" == "1" ]]; then
    echo "安装/更新后端依赖（requirements.txt，后台，不阻塞 uvicorn）..."
    python3 -m pip install -q --upgrade -r requirements.txt &
    PIP_PID=$!
else
    echo "安装/更新后端依赖（requirements.txt，后台，不阻塞 uvicorn）..."
    python3 -m pip install -q -r requirements.txt &
    PIP_PID=$!
fi
cd /workspace/Custombackend/app
# 与 c2 / trackmanager 等同镜像一致：镜像内已装 Fast DDS，但须设置下面变量才能 `import fastdds`。
# c2 里跑后端时 entry/脚本会带上这些（见容器中 python 进程的 /proc/<pid>/environ）；
# xk_docker 仅用 `docker/start.sh` 起 uvicorn 时若未导出，则 DDS 接收器会全部跳过。
if [[ -d /usr/local/eprosima/fastdds_python/lib/python3.10/site-packages ]]; then
  export PYTHONPATH="/opt/fastdds_python_ws/src/Fast-DDS-python/install/fastdds_python_examples/lib/python3.10/site-packages:/opt/fastdds_python_ws/src/Fast-DDS-python/install/fastdds_python/lib/python3.10/site-packages:/usr/local/eprosima/fastdds_python_examples/lib/python3.10/site-packages:/usr/local/eprosima/fastdds_python/lib/python3.10/site-packages${PYTHONPATH:+:$PYTHONPATH}"
  export LD_LIBRARY_PATH="/opt/fastdds_python_ws/src/Fast-DDS-python/install/fastdds_python_examples/lib:/usr/local/eprosima/fastdds/lib:/usr/local/eprosima/fastdds_python_examples/lib:/usr/local/eprosima/fastcdr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  export PATH="/usr/local/eprosima/fastdds/bin:/usr/local/eprosima/foonathan_memory_vendor/bin:$PATH"
fi
python3 -m uvicorn main:app --host 0.0.0.0 --port "${BACKEND_PORT}" &
echo "✅ Custombackend 已后台启动"

echo "========================================"
if [ "$DEV_MODE" = "1" ]; then
    echo "前端: https://<宿主机>:${FRONTEND_PORT} （开发证书为自签，浏览器需「继续访问」）"
else
    echo "前端: http://<宿主机>:${FRONTEND_PORT} （next start，生产 HTTP）"
fi
echo "Custombackend HTTP/WS: http://<宿主机>:${BACKEND_PORT} （WebSocket: /ws）"
echo "========================================"

tail -f /dev/null
