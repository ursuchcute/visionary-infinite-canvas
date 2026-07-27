#!/bin/zsh

set -euo pipefail

ROOT_DIR="${0:A:h}"
WEB_DIR="${ROOT_DIR}/web"
MAIN_SITE_DIR="${MAIN_SITE_DIR:-${ROOT_DIR:h}/aiimageOcO}"
MAIN_URL="http://localhost:3000"
CANVAS_PORT="${CANVAS_PORT:-}"
OPEN_LOCAL_BROWSER="${OPEN_BROWSER:-1}"

fail() {
    print -u2 "\n启动失败：$1"
    if [[ -t 0 ]]; then
        print -u2 "按任意键关闭窗口…"
        read -k 1
    fi
    exit 1
}

[[ -d "${WEB_DIR}" ]] || fail "没有找到画布 web 目录：${WEB_DIR}"
[[ -f "${MAIN_SITE_DIR}/package.json" && -f "${MAIN_SITE_DIR}/scripts/dev.mjs" ]] || fail "没有找到主站项目：${MAIN_SITE_DIR}。可通过 MAIN_SITE_DIR 指定路径。"

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

NPM_BIN="${NODE_BIN:h}/npm"
if [[ ! -x "${NPM_BIN}" ]]; then
    NPM_BIN="$(command -v npm 2>/dev/null || true)"
fi
[[ -n "${NPM_BIN}" && -x "${NPM_BIN}" ]] || fail "没有找到与 Node.js 配套的 npm。"

port_is_free() {
    ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

for port in 3000 3001; do
    port_is_free "${port}" || fail "端口 ${port} 已被占用。请先停止对应本地服务后重试。"
done

if [[ -n "${CANVAS_PORT}" ]]; then
    [[ "${CANVAS_PORT}" =~ '^(0|[1-9][0-9]*)$' ]] || fail "CANVAS_PORT 必须是 1–65535 之间的十进制端口。"
    (( CANVAS_PORT >= 1 && CANVAS_PORT <= 65535 )) || fail "CANVAS_PORT 必须在 1–65535 之间。"
    [[ "${CANVAS_PORT}" != "3000" && "${CANVAS_PORT}" != "3001" ]] || fail "CANVAS_PORT 不能使用主站端口 3000 或 API 端口 3001。"
    port_is_free "${CANVAS_PORT}" || fail "画布端口 ${CANVAS_PORT} 已被占用。"
else
    for candidate in {3002..3012}; do
        if port_is_free "${candidate}"; then
            CANVAS_PORT="${candidate}"
            break
        fi
    done
fi
[[ -n "${CANVAS_PORT}" ]] || fail "没有找到可用的画布端口（3002–3012）。"
CANVAS_URL="http://localhost:${CANVAS_PORT}"

install_dependencies_if_needed() {
    local project_dir="$1"
    local lock_file="${project_dir}/package-lock.json"
    local manifest_file="${project_dir}/package.json"
    local stamp_file="${project_dir}/node_modules/.visionary-package-lock.sha256"
    [[ -f "${lock_file}" ]] || fail "${project_dir:t} 缺少 package-lock.json，无法建立可复现的本地环境。"
    [[ -f "${manifest_file}" ]] || fail "${project_dir:t} 缺少 package.json，无法建立可复现的本地环境。"
    local lock_hash
    lock_hash="$(shasum -a 256 "${lock_file}" | awk '{print $1}')"
    local manifest_hash
    manifest_hash="$(shasum -a 256 "${manifest_file}" | awk '{print $1}')"
    local runtime_signature
    runtime_signature="$("${NODE_BIN}" -p '`${process.platform}-${process.arch}-node-${process.versions.node}-abi-${process.versions.modules}`')"
    local expected_signature="${lock_hash}-${manifest_hash}-${runtime_signature}"
    local installed_signature=""
    [[ -f "${stamp_file}" ]] && installed_signature="$(<"${stamp_file}")"
    if [[ "${installed_signature}" == "${expected_signature}" ]] && ! (
        cd "${project_dir}"
        "${NPM_BIN}" ls --all --silent >/dev/null 2>&1
    ); then
        print "检测到 ${project_dir:t} 的 node_modules 与 npm 锁图不一致，将重新干净安装。"
        installed_signature=""
    fi
    if [[ "${installed_signature}" != "${expected_signature}" ]]; then
        print "依赖锁或 Node.js 运行时已变化，正在干净安装 ${project_dir:t}…"
        (
            cd "${project_dir}"
            "${NPM_BIN}" ci --include=dev --no-audit --no-fund
            print -r -- "${expected_signature}" > "${stamp_file}"
        )
    fi
}

install_dependencies_if_needed "${MAIN_SITE_DIR}"
install_dependencies_if_needed "${WEB_DIR}"

canvas_schema_ready() {
    (
        cd "${MAIN_SITE_DIR}"
        "${NODE_BIN}" --input-type=module -e '
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
    const rows = await prisma.$queryRawUnsafe(`
        SELECT
          (
            SELECT COUNT(*)::int
            FROM information_schema.tables
            WHERE table_schema = $$public$$
              AND table_type = $$BASE TABLE$$
              AND table_name IN (
                $$CanvasSession$$,
                $$CanvasOperation$$,
                $$RuntimeLock$$,
                $$ChatConversation$$
              )
          ) AS canvas_tables,
          (
            SELECT COUNT(*)::int
            FROM information_schema.columns
            WHERE table_schema = $$public$$
              AND (
                (table_name = $$CanvasSession$$ AND column_name IN (
                  $$id$$, $$userId$$, $$parentSessionId$$, $$tokenHash$$,
                  $$csrfTokenHash$$, $$protocolVersion$$, $$expiresAt$$,
                  $$lastSeenAt$$, $$revokedAt$$, $$createdAt$$, $$updatedAt$$
                ))
                OR
                (table_name = $$CanvasOperation$$ AND column_name IN (
                  $$id$$, $$userId$$, $$clientOperationId$$, $$projectId$$,
                  $$nodeId$$, $$kind$$, $$requestHash$$, $$status$$,
                  $$generationId$$, $$chatRunId$$, $$errorCode$$,
                  $$completedAt$$, $$createdAt$$, $$updatedAt$$
                ))
                OR
                (table_name = $$RuntimeLock$$ AND column_name IN (
                  $$key$$, $$scope$$, $$expiresAt$$, $$createdAt$$, $$updatedAt$$
                ))
                OR
                (table_name = $$ChatConversation$$ AND column_name IN (
                  $$surface$$, $$externalRef$$
                ))
              )
          ) AS canvas_columns,
          (
            SELECT COUNT(*)::int
            FROM (
              VALUES
                ($$CanvasSession_tokenHash_key$$, $$CanvasSession$$, true),
                ($$CanvasSession_userId_expiresAt_idx$$, $$CanvasSession$$, false),
                ($$CanvasSession_parentSessionId_revokedAt_expiresAt_idx$$, $$CanvasSession$$, false),
                ($$CanvasSession_expiresAt_idx$$, $$CanvasSession$$, false),
                ($$CanvasOperation_generationId_key$$, $$CanvasOperation$$, true),
                ($$CanvasOperation_chatRunId_key$$, $$CanvasOperation$$, true),
                ($$CanvasOperation_userId_clientOperationId_key$$, $$CanvasOperation$$, true),
                ($$CanvasOperation_userId_projectId_createdAt_idx$$, $$CanvasOperation$$, false),
                ($$CanvasOperation_status_updatedAt_idx$$, $$CanvasOperation$$, false),
                ($$RuntimeLock_pkey$$, $$RuntimeLock$$, true),
                ($$RuntimeLock_expiresAt_idx$$, $$RuntimeLock$$, false),
                ($$RuntimeLock_scope_expiresAt_idx$$, $$RuntimeLock$$, false),
                ($$ChatConversation_userId_surface_deletedAt_lastMessageAt_idx$$, $$ChatConversation$$, false),
                ($$ChatConversation_userId_surface_externalRef_key$$, $$ChatConversation$$, true)
            ) AS required_index(index_name, table_name, must_be_unique)
            JOIN pg_class index_ref ON index_ref.relname = required_index.index_name
            JOIN pg_index index_state ON index_state.indexrelid = index_ref.oid
            JOIN pg_namespace schema_ref ON schema_ref.oid = index_ref.relnamespace
            JOIN pg_class table_ref ON table_ref.oid = index_state.indrelid
            JOIN pg_namespace table_schema_ref ON table_schema_ref.oid = table_ref.relnamespace
            WHERE schema_ref.nspname = $$public$$
              AND table_schema_ref.nspname = $$public$$
              AND table_ref.relname = required_index.table_name
              AND index_state.indisvalid
              AND index_state.indisready
              AND (NOT required_index.must_be_unique OR index_state.indisunique)
          ) AS canvas_indexes,
          (
            SELECT COUNT(*)::int
            FROM (
              VALUES
                ($$CanvasSession_userId_fkey$$, $$CanvasSession$$, $$User$$),
                ($$CanvasOperation_userId_fkey$$, $$CanvasOperation$$, $$User$$)
            ) AS required_fk(constraint_name, table_name, referenced_table_name)
            JOIN pg_constraint constraint_ref
              ON constraint_ref.conname = required_fk.constraint_name
            JOIN pg_class table_ref ON table_ref.oid = constraint_ref.conrelid
            JOIN pg_namespace table_schema_ref ON table_schema_ref.oid = table_ref.relnamespace
            JOIN pg_class referenced_table_ref ON referenced_table_ref.oid = constraint_ref.confrelid
            JOIN pg_namespace referenced_schema_ref ON referenced_schema_ref.oid = referenced_table_ref.relnamespace
            WHERE constraint_ref.contype = $$f$$
              AND constraint_ref.convalidated
              AND table_schema_ref.nspname = $$public$$
              AND referenced_schema_ref.nspname = $$public$$
              AND table_ref.relname = required_fk.table_name
              AND referenced_table_ref.relname = required_fk.referenced_table_name
          ) AS canvas_foreign_keys
    `);
    const state = rows[0] || {};
    if (
      Number(state.canvas_tables) !== 4
      || Number(state.canvas_columns) !== 32
      || Number(state.canvas_indexes) !== 14
      || Number(state.canvas_foreign_keys) !== 2
    ) process.exitCode = 1;
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
} finally {
    await prisma.$disconnect();
}
'
    )
}

if ! canvas_schema_ready; then
    fail "数据库缺少 Canvas 所需表、字段、索引或外键。为避免误连共享/生产库，本启动器只做只读检查且不会自动运行主站全量结构同步。请先核对主站 DATABASE_URL，并在受控开发数据库中手动完成 Canvas 迁移后重试。"
fi

print "使用 Node.js $("${NODE_BIN}" --version)"
print "正在启动本地主站：${MAIN_URL}"
(
    cd "${MAIN_SITE_DIR}"
    env \
        VITE_CANVAS_ENABLED=true \
        VITE_CANVAS_APP_URL="${CANVAS_URL}" \
        CANVAS_ENABLED=true \
        CANVAS_ALLOWED_EMAILS=jsermjc@sina.com \
        CANVAS_APP_ORIGIN="${CANVAS_URL}" \
        CANVAS_APP_HOST=localhost \
        CANVAS_RELEASE_VERSION=local \
        ALLOWED_ORIGINS="${CANVAS_URL}" \
        "${NODE_BIN}" scripts/dev.mjs
) &
MAIN_PID=$!

print "正在启动 Hosted 画布：${CANVAS_URL}"
(
    cd "${WEB_DIR}"
    env \
        VITE_VISIONARY_HOSTED=1 \
        VITE_VISIONARY_PARENT_ORIGIN="${MAIN_URL}" \
        VITE_VISIONARY_HOST_API_ORIGIN=http://localhost:3001 \
        VITE_VISIONARY_RELEASE_VERSION=local \
        VITE_VISIONARY_SOURCE_REVISION=local \
        "${NODE_BIN}" node_modules/vite/bin/vite.js --host 0.0.0.0 --port "${CANVAS_PORT}" --strictPort
) &
CANVAS_PID=$!

CLEANED_UP=0
cleanup() {
    (( CLEANED_UP )) && return
    CLEANED_UP=1
    kill "${CANVAS_PID}" "${MAIN_PID}" >/dev/null 2>&1 || true
    wait "${CANVAS_PID}" >/dev/null 2>&1 || true
    wait "${MAIN_PID}" >/dev/null 2>&1 || true
}
trap 'exit 0' HUP INT TERM
trap cleanup EXIT

service_is_ready() {
    curl --silent --fail --max-time 1 "$1" >/dev/null 2>&1
}

api_is_ready() {
    local http_status
    http_status="$(curl --silent --max-time 1 --output /dev/null --write-out "%{http_code}" "$1" 2>/dev/null || true)"
    [[ "${http_status}" =~ '^(2[0-9][0-9]|401)$' ]]
}

canvas_api_is_ready() {
    local http_status
    http_status="$(curl --silent --max-time 1 --output /dev/null --write-out "%{http_code}" "$1" 2>/dev/null || true)"
    [[ "${http_status}" == "204" ]]
}

for _ in {1..240}; do
    if service_is_ready "${MAIN_URL}/" && service_is_ready "${CANVAS_URL}/" && api_is_ready "http://localhost:3001/api/auth/me" && canvas_api_is_ready "http://localhost:3001/api/canvas/v1/readiness"; then
        print "\nHosted 本地联调已启动：${MAIN_URL}/canvas"
        print "请使用 jsermjc@sina.com 登录本地主站，再从主站进入画布。"
        if [[ "${OPEN_LOCAL_BROWSER}" != "0" ]]; then
            open "${MAIN_URL}/canvas" >/dev/null 2>&1 || true
        fi
        while kill -0 "${MAIN_PID}" >/dev/null 2>&1 && kill -0 "${CANVAS_PID}" >/dev/null 2>&1; do
            sleep 1
        done
        fail "本地主站或 Hosted 画布已退出，请查看上方错误。"
    fi
    if ! kill -0 "${MAIN_PID}" >/dev/null 2>&1 || ! kill -0 "${CANVAS_PID}" >/dev/null 2>&1; then
        fail "本地服务提前退出，请查看上方错误。"
    fi
    sleep 0.25
done

fail "等待本地主站或 Hosted 画布启动超时。"
