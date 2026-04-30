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
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    if [[ "${NEXUS_DOCKER_NO_KILL:-0}" != "1" ]]; then
        free_tcp_port "${FRONTEND_PORT}" || true
    fi
    if ss -tln 2>/dev/null | grep -q ":${FRONTEND_PORT}"; then
        echo "❌ TCP ${FRONTEND_PORT} 仍被占用，已跳过 next start。"
    else
        npm run build
        npm run start &
    fi
fi

echo "启动 Custombackend（端口 ${BACKEND_PORT}）..."
cd /workspace/Custombackend
echo "安装/更新后端依赖（requirements.txt）..."
if [[ "${NEXUS_PY_UPGRADE:-0}" == "1" ]]; then
    python3 -m pip install -q --upgrade -r requirements.txt
else
    python3 -m pip install -q -r requirements.txt
fi
cd /workspace/Custombackend/app
python3 -m uvicorn main:app --host 0.0.0.0 --port "${BACKEND_PORT}" &
echo "✅ Custombackend 已后台启动"

echo "========================================"
echo "前端: https://<宿主机>:${FRONTEND_PORT} （开发证书为自签，浏览器需「继续访问」）"
echo "Custombackend HTTP/WS: http://<宿主机>:${BACKEND_PORT} （WebSocket: /ws）"
echo "========================================"

tail -f /dev/null
