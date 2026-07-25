#!/bin/zsh

set -euo pipefail

ROOT_DIR="${0:A:h}"
WEB_DIR="${ROOT_DIR}/web"
LOCAL_PORT="${PORT:-3002}"
LOCAL_URL="http://localhost:${LOCAL_PORT}/canvas"
OPEN_LOCAL_BROWSER="${OPEN_BROWSER:-1}"

fail() {
    print -u2 "\n启动失败：$1"
    if [[ -t 0 ]]; then
        print -u2 "按任意键关闭窗口…"
        read -k 1
    fi
    exit 1
}

[[ "${LOCAL_PORT}" =~ '^[0-9]+$' ]] || fail "PORT 必须是数字。"
[[ -d "${WEB_DIR}" ]] || fail "没有找到 web 目录：${WEB_DIR}"

is_project_running() {
    curl --silent --fail --max-time 1 "http://127.0.0.1:${LOCAL_PORT}/" 2>/dev/null | grep -q "Visionary Infinite Canvas"
}

if is_project_running; then
    print "Visionary Infinite Canvas 已在运行：${LOCAL_URL}"
    if [[ "${OPEN_LOCAL_BROWSER}" != "0" ]]; then
        open "${LOCAL_URL}" >/dev/null 2>&1 || true
    fi
    exit 0
fi

is_compatible_node() {
    "$1" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 20 ? (minor >= 19 ? 0 : 1) : major >= 22 ? (major > 22 || minor >= 12 ? 0 : 1) : 1)'
}

NODE_BIN=""
NODE_CANDIDATES=()
SYSTEM_NODE="$(command -v node 2>/dev/null || true)"
[[ -n "${SYSTEM_NODE}" ]] && NODE_CANDIDATES+=("${SYSTEM_NODE}")
for candidate in "${HOME}"/.nvm/versions/node/*/bin/node(N); do
    NODE_CANDIDATES+=("${candidate}")
done
NODE_CANDIDATES+=(
    "/opt/homebrew/bin/node"
    "/usr/local/bin/node"
    "${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
)

for candidate in "${NODE_CANDIDATES[@]}"; do
    if [[ -x "${candidate}" ]] && is_compatible_node "${candidate}"; then
        NODE_BIN="${candidate}"
        break
    fi
done

[[ -n "${NODE_BIN}" ]] || fail "需要 Node.js 20.19+ 或 22.12+。请先安装新版 Node.js 后重试。"

export PATH="${NODE_BIN:h}:${PATH}"
print "使用 Node.js $("${NODE_BIN}" --version)"

cd "${WEB_DIR}"
if [[ ! -f "node_modules/vite/bin/vite.js" || ! -x "node_modules/esbuild/bin/esbuild" ]]; then
    command -v npm >/dev/null 2>&1 || fail "缺少前端依赖，同时没有找到 npm。"
    print "首次启动，正在安装前端依赖…"
    npm install --no-audit --no-fund
fi

print "正在启动：${LOCAL_URL}"
"${NODE_BIN}" node_modules/vite/bin/vite.js --host 0.0.0.0 --port "${LOCAL_PORT}" &
SERVER_PID=$!

cleanup() {
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
}
trap cleanup INT TERM EXIT

for _ in {1..80}; do
    if is_project_running; then
        print "\n启动成功：${LOCAL_URL}"
        if [[ "${OPEN_LOCAL_BROWSER}" != "0" ]]; then
            open "${LOCAL_URL}" >/dev/null 2>&1 || true
        fi
        wait "${SERVER_PID}"
        exit $?
    fi
    if ! kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
        wait "${SERVER_PID}" || true
        fail "开发服务器提前退出，请查看上方错误。"
    fi
    sleep 0.25
done

fail "等待开发服务器超时。"
