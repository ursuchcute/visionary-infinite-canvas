import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { assertCanvasCspHeaders } from "./hosted-csp-contract.mjs";
import { CURRENT_HOSTED_BUILD_METADATA_VERSION, hostedBuildMetadataVersion, requiresCurrentHostedContract } from "./hosted-release-contract.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(webRoot, "..");
const readWebSource = (relativePath) => readFileSync(path.join(webRoot, relativePath), "utf8");
const readRepositorySource = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), "utf8");

const quoteHook = readWebSource("src/hooks/use-visionary-image-quote.ts");
const hostClient = readWebSource("src/services/api/visionary-host/client.ts");
const hostedConstants = readWebSource("src/constant/visionary-hosted.ts");
const imageCompression = readWebSource("src/lib/reference-image-compression.ts");
const viteConfig = readWebSource("vite.config.ts");
const project = readWebSource("src/pages/canvas/project.tsx");
const projectIndex = readWebSource("src/pages/canvas/index.tsx");
const operations = readWebSource("src/services/api/visionary-host/operations.ts");
const operationState = readWebSource("src/services/api/visionary-host/operation-state.ts");
const hostStore = readWebSource("src/stores/use-visionary-host-store.ts");
const canvasStore = readWebSource("src/stores/canvas/use-canvas-store.ts");
const canvasGeneration = readWebSource("src/components/canvas/canvas-node-generation.ts");
const deleteProjectsDialog = readWebSource("src/components/canvas/canvas-delete-projects-dialog.tsx");
const projectCard = readWebSource("src/components/canvas/canvas-project-card.tsx");
const projectLock = readWebSource("src/lib/canvas/canvas-project-lock.ts");
const localForageStorage = readWebSource("src/lib/localforage-storage.ts");
const imageStorage = readWebSource("src/services/image-storage.ts");
const assetStore = readWebSource("src/stores/use-asset-store.ts");
const promptStore = readWebSource("src/stores/use-prompt-store.ts");
const canvasSidePanel = readWebSource("src/components/canvas/canvas-side-panel.tsx");
const promptEditorDialog = readWebSource("src/pages/prompts/components/my-prompt-editor-dialog.tsx");
const deployScript = readWebSource("scripts/deploy-hosted.mjs");
const hostedDistAudit = readWebSource("scripts/audit-hosted-dist.mjs");
const dependencyAudit = readWebSource("scripts/audit-hosted-dependencies.mjs");
const nginxHeaders = readRepositorySource("ops/nginx/visionary-canvas-security-headers.conf");
const hostedLauncher = readRepositorySource("start-hosted-local.command");
const dockerfile = readRepositorySource("Dockerfile");
const rootVercel = readRepositorySource("vercel.json");
const webVercel = readWebSource("vercel.json");
const packageManifest = JSON.parse(readWebSource("package.json"));

assert.match(quoteHook, /quoteVisionaryHostImage\(\s*createVisionaryOperationContext\(projectId, nodeId, "quote"\),\s*\{/);
assert.doesNotMatch(quoteHook, /\bprompt\b/);
assert.doesNotMatch(quoteHook, /\bprompt,\s*\{\s*model:/);
assert.match(quoteHook, /setState\(\{ loading: true \}\);[\s\S]*window\.setTimeout/);

assert.match(hostClient, /quoteVisionaryHostImage\(context: VisionaryHostRequestContext, parameters: HostImageParameters, signal\?: AbortSignal\)/);
assert.match(hostClient, /protocolVersion: VISIONARY_HOST_PROTOCOL_VERSION/);
assert.doesNotMatch(hostClient, /protocolVersion: 1,\s*iframeNonce: nonce/);
assert.match(hostClient, /const request = buildImageRequest\(context, "", parameters\);/);
assert.match(hostClient, /for \(const reference of references\)/);
assert.match(hostClient, /prepareReferenceImageForUpload/);
assert.match(hostClient, /MAX_HOST_REFERENCE_TOTAL_BYTES = 30 \* 1024 \* 1024/);
assert.match(hostClient, /preparedReferenceBlobs = new WeakMap/);
assert.match(hostClient, /Math\.floor\(MAX_HOST_REFERENCE_TOTAL_BYTES \/ Math\.max\(1, references\.length\)\)/);
assert.match(hostClient, /source\.startsWith\("data:"\) \? dataUrlToBlob\(source\)/);
assert.doesNotMatch(hostClient, /Promise\.all\(references\.map\(referenceImageBlob\)\)/);
const imageRequestSource = hostClient.slice(hostClient.indexOf("export async function requestVisionaryHostImage"), hostClient.indexOf("export async function recoverStoredVisionaryHostImages"));
assert.ok(imageRequestSource.indexOf("buildImageFormData") < imageRequestSource.indexOf("persistHostOperationPreflight"));
assert.ok(imageRequestSource.indexOf("persistHostOperationPreflight") < imageRequestSource.indexOf('hostResponse("/images"'));
assert.match(hostClient, /saveHostOperation\(\{/);
assert.ok((hostClient.match(/options\?\.hostAdmissionGroupId \|\| context\.clientOperationId/g) || []).length >= 3);
assert.ok((hostClient.match(/admissionGroupId,\s*status: "preflight"/g) || []).length >= 2);
assert.equal((hostClient.match(/status: "preflight"/g) || []).length, 2);
assert.match(hostClient, /VisionaryHostOperationPendingError/);
assert.match(hostClient, /VisionaryHostAdmissionBlockedError/);
assert.match(hostClient, /throw new VisionaryHostAdmissionBlockedError\(blocking\.clientOperationId, blocking\.nodeId, context\.nodeId\)/);
assert.match(hostClient, /VisionaryHostPreDispatchError/);
assert.match(hostClient, /assertHostMutationReady\(\);\s*await options\?\.onHostOperationTargetReady/);
assert.ok((hostClient.match(/error instanceof VisionaryHostPreDispatchError/g) || []).length >= 3);
assert.match(hostClient, /recoverStoredVisionaryHostImages/);
assert.match(hostClient, /recoveryPatch\(result, recordById\.get\(result\.operationId\)\)/);
assert.match(hostClient, /HOST_IMAGE_RECOVERY_BATCH_LIMIT = 6/);
assert.match(hostClient, /for \(let offset = 0; offset < active\.length; offset \+= HOST_IMAGE_RECOVERY_BATCH_LIMIT\)/);
assert.match(hostClient, /if \(ratio\.toLowerCase\(\) === "auto"\) return "auto"/);
assert.match(operationState, /HOST_OPERATION_PENDING_NOT_FOUND_GRACE_MS = 2 \* 60_000/);
assert.match(operationState, /HOST_OPERATION_SUBMITTING_NOT_FOUND_GRACE_MS = 24 \* 60 \* 60_000/);
assert.match(hostStore, /model\.key === "chat-pro" && \(!label \|\| label\.toLowerCase\(\) === "chat-pro"\)/);
assert.match(hostStore, /return "gpt-5\.5"/);
assert.match(hostStore, /if \(!hostedUserStorageHydrated\) \{[\s\S]*applyBootstrapConfig\(bootstrap\);[\s\S]*await hydrateHostedUserStorage\(\);[\s\S]*hostedUserStorageHydrated = true;/);
assert.doesNotMatch(hostStore, /applyBootstrapConfig\(bootstrap\);\s*if \(shouldHydrate\)/);
assert.match(project, /timer = window\.setTimeout\(recover/);
assert.match(project, /primaryImageId: node\.metadata\?\.primaryImageId \|\| target\.id/);
assert.match(hostClient, /createTextRunSafely/);
assert.match(hostClient, /saveHostTextOperation/);
assert.match(hostClient, /VisionaryHostPreflightCancelledError/);
assert.match(hostClient, /if \(isAbortError\(error\)\) \{\s*throw new VisionaryHostPreflightCancelledError\(context\.clientOperationId, context\.nodeId\);/);
const textRequestSource = hostClient.slice(hostClient.indexOf("export async function requestVisionaryHostText"), hostClient.indexOf("export async function cancelVisionaryHostTextRun"));
assert.ok(textRequestSource.indexOf("getOrCreateTextConversation") < textRequestSource.indexOf("saveHostTextOperation"));
assert.ok(textRequestSource.indexOf("saveHostTextOperation") < textRequestSource.indexOf("createTextRunSafely"));
assert.ok(textRequestSource.indexOf("persistHostOperationPreflight") < textRequestSource.indexOf("createTextRunSafely"));
const durablePreflightSource = hostClient.slice(hostClient.indexOf("async function persistHostOperationPreflight"), hostClient.indexOf("function isAbortError"));
assert.ok(durablePreflightSource.indexOf("onHostOperationTargetReady") < durablePreflightSource.indexOf("saveOperation()"));
assert.ok(durablePreflightSource.indexOf("saveOperation()") < durablePreflightSource.indexOf("onHostOperationDurable"));
assert.ok(durablePreflightSource.indexOf("onHostOperationDurable") < durablePreflightSource.indexOf("await markOperationReady()"));
assert.ok(durablePreflightSource.indexOf("admissionTransitionStarted = true") < durablePreflightSource.indexOf("await markOperationReady()"));
assert.match(durablePreflightSource, /if \(admissionTransitionStarted\) \{\s*throw new VisionaryHostOperationPendingError/);
assert.match(durablePreflightSource, /acknowledgeHostOperation\(context\.clientOperationId\)/);
assert.match(durablePreflightSource, /onHostOperationPreflightFailed/);
assert.ok(durablePreflightSource.indexOf("await failOperation(terminalError)") < durablePreflightSource.indexOf("await options?.onHostOperationPreflightFailed?.(context)"));
assert.ok(durablePreflightSource.indexOf("await options?.onHostOperationPreflightFailed?.(context)") < durablePreflightSource.indexOf("await acknowledgeHostOperation(context.clientOperationId)"));
assert.match(hostClient, /recoverStoredVisionaryHostTexts/);
assert.match(hostClient, /HOST_OPERATION_PREFLIGHT_GRACE_MS = 2 \* 60_000/);
assert.equal((hostClient.match(/item\.status === "preflight" && recoveryNow - item\.createdAt >= HOST_OPERATION_PREFLIGHT_GRACE_MS/g) || []).length, 2);
assert.equal((hostClient.match(/status === "preflight" && recoveryNow - .*\.createdAt < HOST_OPERATION_PREFLIGHT_GRACE_MS/g) || []).length, 2);
assert.equal((hostClient.match(/await onActive\?\.\(\[\.\.\.blockingPreflight, \.\.\.active\]\)/g) || []).length, 2);
assert.equal((hostClient.match(/status === "preflight" \|\| record\.status === "submitting" \|\| record\.status === "pending"/g) || []).length, 2);
assert.match(hostClient, /\.filter\(\(record\) => isHostAdmissionBlocking\(record, admissionNodeId, admissionGroupId\)\)/);
assert.match(hostClient, /navigator\.locks\.request\(lockName, \{ mode: "exclusive", signal \}, run\)/);
assert.match(hostClient, /该节点已有任务正在生成或确认，请勿重复提交/);
assert.match(hostClient, /const active = records\.filter\(\(item\) => item\.status === "submitting" \|\| item\.status === "pending"\)/);
assert.match(hostClient, /let admitted = Boolean\(record\.runId\)/);
assert.match(hostClient, /admitted = true/);
assert.match(hostClient, /shouldMarkTextRecoveryClientFailure\(admitted, error\.status\)/);
assert.match(hostClient, /if \(snapshotStatus === "completed"\)/);
assert.match(hostClient, /snapshotStatus === "cancelled" \|\| snapshotStatus === "failed"/);
assert.match(hostClient, /if \(!response\.ok\) throw responseError\(response\.status, payload, "停止文本生成失败。"\)/);
assert.doesNotMatch(hostClient, /response\.status === 409\) return "cancelled"/);
assert.match(project, /const textCount = VISIONARY_HOSTED \? 1/);
assert.match(project, /buildHostedConfirmingNodeIds\(nodesRef\.current, connectionsRef\.current\)\.has\(nodeId\)/);
assert.match(project, /restoreActiveHostedOperationGuards/);
assert.match(project, /if \(VISIONARY_HOSTED && !hostRecoveryReadyRef\.current\)/);
assert.match(project, /isConfirming=\{!hostRecoveryReady \|\| hostedConfirmingNodeIds\.has\(panelNode\.id\)\}/);
assert.match(project, /图片已生成且不会重复扣分，但浏览器暂未保存成功/);
assert.match(project, /图片已生成且不会重复扣分，但浏览器保存失败/);
assert.match(project, /if \(VISIONARY_HOSTED\) await flushAssetStorePersistence\(\);\s*message\.success\("已加入我的资产"\)/);
assert.match(project, /node\.metadata\?\.status === NODE_STATUS_LOADING && !node\.metadata\?\.hostOperationId/);
assert.match(project, /clearHostedPreflightGuard\(prev, error\.operationId, error\.nodeId, nodeId\)/);
assert.match(project, /clearHostedPreflightGuard\(prev, error\.operationId, error\.nodeId, sourceNode\.id\)/);
assert.match(project, /onHostOperationTargetReady: async \(context\) =>/);
assert.match(project, /onHostOperationDurable: async \(context\) =>/);
assert.match(project, /onHostOperationPreflightFailed: async \(context\) =>/);
assert.match(project, /updateProject\(projectId, \{ nodes: nextNodes, connections: nextConnections \}\);[\s\S]*await flushCanvasStorePersistence\(\);/);
assert.match(project, /onHostOperationPreflightFailed: async \(context\) => \{\s*const nextNodes = clearHostedPreflightGuard\(nodesRef\.current,[\s\S]*nodesRef\.current = nextNodes;\s*flushSync\(\(\) => \{\s*setNodes\(nextNodes\);/);
assert.match(project, /hasHostedOperationConflict\(allIds, currentNodes, currentConnections, generationRequestsRef\.current\.values\(\)\)/);
assert.match(project, /generationRequestsRef\.current\.forEach\(\(request\) => request\.controller\.abort\(\)\);[\s\S]*generationRequestsRef\.current\.clear\(\);/);
assert.match(project, /buildProtectedHostedNodeIds\(nodesRef\.current, connectionsRef\.current, generationRequestsRef\.current\.values\(\)\)\.size/);
assert.match(project, /const applyHistory = useCallback[\s\S]*if \(protectedIds\.size\) \{[\s\S]*暂时不能撤销或重做/);
assert.match(project, /if \(!existingNode \|\| targetConflict\) \{[\s\S]*recoveredHostedNodeId\("image", record\.clientOperationId\)/);
assert.match(project, /if \(!existingNode \|\| targetConflict\) \{[\s\S]*recoveredHostedNodeId\("text", record\.clientOperationId\)/);
assert.match(project, /if \(!existingNode \|\| targetConflict\) return true/);
assert.ok((project.match(/await getImageBlob\(/g) || []).length >= 2);
assert.match(project, /if \(!VISIONARY_HOSTED \|\| mode !== "image"\) \{\s*generationContext = await hydrateNodeGenerationContext\(rawGenerationContext\);/);
assert.match(project, /finishGenerationRequest\(nodeId, runController\);\s*setRunningNodeId\(null\);[\s\S]*参考图片读取失败/);
assert.ok((project.match(/await persistHostedRecoveryNodes\(/g) || []).length >= 4);
assert.match(project, /await flushCanvasStorePersistence\(\);/);
assert.match(canvasGeneration, /for \(const image of context\.referenceImages\)/);
assert.doesNotMatch(canvasGeneration, /Promise\.all\(context\.referenceImages\.map/);
assert.match(canvasStore, /export async function flushCanvasStorePersistence\(\)/);
assert.match(canvasStore, /await localForageStorage\.setItem\(visionaryHostStorageKey\(queued\.name\), JSON\.stringify\(queued\.value\)\)/);
assert.match(canvasStore, /const write = activePersistWrite \|\| \(queuedPersistWrite \? startCanvasPersistWrite\(\) : null\)/);
assert.match(canvasStore, /export async function reloadCanvasStoreFromPersistence\(\)/);
assert.match(canvasStore, /discardCanvasStorePersistenceQueue\(\);\s*await useCanvasStore\.persist\.rehydrate\(\);/);
assert.match(project, /\.request\(canvasStoreLockName\(\), \{ mode: "exclusive", ifAvailable: true \}/);
assert.match(project, /await reloadHostedCanvasStoresFromPersistence\(\);[\s\S]*setHostProjectLease\(\{ projectId, status: "owned" \}\)/);
assert.match(project, /\.catch\(\(\) => \{[\s\S]*status: "unavailable"/);
assert.match(project, /画布本地数据暂时无法安全读取/);
assert.match(project, /if \(leaseOwned && projectLoadedRef\.current\) \{[\s\S]*updateProject\(projectId, \{[\s\S]*nodes: nodesRef\.current,[\s\S]*connections: connectionsRef\.current,[\s\S]*chatSessions: chatSessionsRef\.current,[\s\S]*viewport: viewportRef\.current/);
assert.match(project, /if \(!leaseOwned\) \{[\s\S]*releaseLease\?\.\(\);[\s\S]*return;/);
assert.match(project, /hostProjectLeaseRef\.current = \{ projectId, owned: false \};[\s\S]*flushHostedCanvasStoresPersistence\(\)[\s\S]*releaseLease/);
assert.match(project, /const flushAndReleaseLease = async \(\) => \{[\s\S]*window\.setTimeout\(\(\) => void flushAndReleaseLease\(\), 1_000\)/);
assert.match(project, /if \(VISIONARY_HOSTED\) await flushAssetStorePersistence\(\);[\s\S]*message\.success\("已加入我的资产"\)/);
assert.match(project, /useAssetStore\.setState\(\{ assets: previousAssets \}\);[\s\S]*flushAssetStorePersistence\(\)\.catch/);
assert.match(projectLock, /return "visionary-canvas-store"/);
assert.match(projectLock, /Promise\.allSettled\(\[reloadAssetStoreFromPersistence\(\), reloadPromptStoreFromPersistence\(\)\]\)/);
assert.match(projectLock, /Promise\.allSettled\(\[flushCanvasStorePersistence\(\), flushAssetStorePersistence\(\), flushPromptStorePersistence\(\)\]\)/);
assert.match(projectLock, /Promise\.allSettled\(\[flushLocalForageStorageWrites\(\)\]\)/);
assert.match(projectLock, /holdCanvasStoreLeaseUntilDocumentExit/);
assert.match(projectLock, /await reloadHostedCanvasStoresFromPersistence\(\);[\s\S]*catch \{[\s\S]*await holdCanvasStoreLeaseUntilDocumentExit\(\)/);
assert.doesNotMatch(projectLock, /reloadHostedCanvasStoresFromPersistence\(\)\.catch\(\(\) => undefined\)/);
assert.match(projectLock, /if \(typeof navigator === "undefined" \|\| !navigator\.locks\) \{\s*throw new CanvasProjectLockUnsupportedError\(\);/);
assert.match(projectLock, /if \(!lock\) throw new CanvasProjectInUseError\(\);/);
assert.match(projectIndex, /withHostedCanvasStoreLock\(async \(\) =>/);
assert.match(projectIndex, /await flushCanvasStorePersistence\(\);/);
assert.match(deleteProjectsDialog, /withHostedCanvasStoreLock\(async \(\) =>/);
assert.match(deleteProjectsDialog, /listHostOperations\(projectId\)/);
assert.match(deleteProjectsDialog, /listHostTextOperations\(projectId\)/);
assert.match(deleteProjectsDialog, /operationCounts\.some\(\(count\) => count > 0\)/);
assert.match(deleteProjectsDialog, /deleteProjects\(existingIds\);\s*await flushCanvasStorePersistence\(\);/);
assert.match(deleteProjectsDialog, /await Promise\.all\(\[cleanupUnusedImages\(usedData\), cleanupUnusedMedia\(usedData\)\]\)/);
assert.match(deleteProjectsDialog, /if \(!existingIds\.length\) throw new Error\("PROJECT_NOT_FOUND"\)/);
assert.match(projectCard, /withHostedCanvasStoreLock\(async \(\) =>/);
assert.match(projectCard, /renameProject\(project\.id, editingTitle\);\s*await flushCanvasStorePersistence\(\);/);
assert.match(projectCard, /if \(!previousProjects\.some\(\(item\) => item\.id === project\.id\)\)/);
assert.match(localForageStorage, /__local_override_v1/);
assert.match(localForageStorage, /hasCurrentOverride && fallback !== null/);
const storageReadSource = localForageStorage.slice(localForageStorage.indexOf("getItem:"), localForageStorage.indexOf("setItem:"));
assert.doesNotMatch(storageReadSource, /localforage\.(setItem|removeItem)/);
assert.match(localForageStorage, /if \(VISIONARY_HOSTED && !hasCurrentOverride\) throw error/);
assert.match(localForageStorage, /flushLocalForageStorageWrites/);
assert.match(imageStorage, /IMAGE_GC_GRACE_MS = 5 \* 60_000/);
assert.match(imageStorage, /now - storedImageCreatedAt\(value\) >= IMAGE_GC_GRACE_MS/);
assert.match(assetStore, /export async function flushAssetStorePersistence\(\)/);
assert.match(assetStore, /if \(!queuedAssetPersist\) queuedAssetPersist = queued/);
assert.match(assetStore, /persistedAssetSnapshot = queued\.snapshot/);
assert.ok(assetStore.indexOf("await localForageStorage.setItem") < assetStore.indexOf("persistedAssetSnapshot = queued.snapshot"));
assert.match(assetStore, /if \(VISIONARY_HOSTED\) return asset/);
assert.match(assetStore, /if \(!VISIONARY_HOSTED\) get\(\)\.cleanupImages/);
assert.match(promptStore, /export async function flushPromptStorePersistence\(\)/);
assert.match(promptStore, /if \(!queuedPromptPersist\) queuedPromptPersist = queued/);
assert.match(promptStore, /persistedPromptSnapshot = queued\.value/);
assert.ok(promptStore.indexOf("await localForageStorage.setItem") < promptStore.indexOf("persistedPromptSnapshot = queued.value"));
assert.match(promptStore, /partialize: \(state\) => \(\{ prompts: state\.prompts \}\)/);
assert.match(hostStore, /Promise\.allSettled\(\[useCanvasStore\.persist\.rehydrate\(\), useAssetStore\.persist\.rehydrate\(\), usePromptStore\.persist\.rehydrate\(\)\]\)/);
assert.match(canvasSidePanel, /if \(VISIONARY_HOSTED && added\) await flushAssetStorePersistence\(\);[\s\S]*message\.success\(`已添加 \$\{added\} 个资产`\)/);
assert.match(canvasSidePanel, /if \(VISIONARY_HOSTED\) await flushPromptStorePersistence\(\);[\s\S]*message\.success\(editingPrompt \? "提示词已更新" : "提示词已添加"\)/);
assert.match(promptEditorDialog, /onSave: \(value: PersonalPromptInput\) => void \| Promise<void>/);
assert.match(promptEditorDialog, /await onSave\(\{/);
assert.match(operations, /record\.kind === "text" && record\.projectId === projectId/);
assert.doesNotMatch(operations, /MAX_OPERATION_AGE_MS|expired\.push|now - record\.updatedAt/);
assert.match(imageCompression, /MAX_REFERENCE_IMAGE_BYTES = 6 \* 1024 \* 1024/);
assert.match(imageCompression, /REFERENCE_IMAGE_COMPRESSION_TRIGGER_BYTES = 3 \* 1024 \* 1024/);
assert.match(imageCompression, /MAX_REFERENCE_INPUT_BYTES = 30 \* 1024 \* 1024/);
assert.match(imageCompression, /MPO_SIGNATURE/);
assert.match(imageCompression, /prepareReferenceImageForUpload\(source: Blob, maxBytes = MAX_REFERENCE_IMAGE_BYTES\)/);
assert.match(imageCompression, /attempt < 7/);
assert.match(imageCompression, /image\/webp/);
assert.match(imageCompression, /image\/jpeg/);

assert.match(nginxHeaders, /connect-src 'self' blob:/);
assert.match(viteConfig, /"connect-src 'self' blob: ws:"/);
assert.match(viteConfig, /"script-src 'self' 'unsafe-inline'"/);
assert.match(viteConfig, /"\/api\/canvas\/v1": \{\s*target: visionaryHostApiOrigin,\s*changeOrigin: false,/);

assert.match(hostedLauncher, /VITE_VISIONARY_HOSTED=1/);
assert.match(hostedLauncher, /CANVAS_URL="http:\/\/localhost:\$\{CANVAS_PORT\}"/);
assert.match(hostedLauncher, /CANVAS_PORT >= 1 && CANVAS_PORT <= 65535/);
assert.match(hostedLauncher, /CANVAS_PORT.*!= "3000".*CANVAS_PORT.*!= "3001"/);
assert.match(hostedLauncher, /VITE_CANVAS_APP_URL="\$\{CANVAS_URL\}"/);
assert.match(hostedLauncher, /CANVAS_ALLOWED_EMAILS=jsermjc@sina\.com/);
assert.match(hostedLauncher, /canvas_schema_ready\(\)/);
assert.match(hostedLauncher, /启动器只做只读检查且不会自动运行主站全量结构同步/);
assert.match(hostedLauncher, /Number\(state\.canvas_tables\) !== 4/);
assert.match(hostedLauncher, /Number\(state\.canvas_columns\) !== 32/);
assert.match(hostedLauncher, /Number\(state\.canvas_indexes\) !== 14/);
assert.match(hostedLauncher, /Number\(state\.canvas_foreign_keys\) !== 2/);
assert.match(hostedLauncher, /table_type = \$\$BASE TABLE\$\$/);
assert.match(hostedLauncher, /table_ref\.relname = required_index\.table_name/);
assert.match(hostedLauncher, /NOT required_index\.must_be_unique OR index_state\.indisunique/);
assert.match(hostedLauncher, /referenced_table_ref\.relname = required_fk\.referenced_table_name/);
assert.match(hostedLauncher, /NPM_BIN}" ci --include=dev --no-audit --no-fund/);
assert.match(hostedLauncher, /NPM_BIN}" ls --all --silent/);
assert.match(hostedLauncher, /\.visionary-package-lock\.sha256/);
assert.match(hostedLauncher, /api_is_ready "http:\/\/localhost:3001\/api\/auth\/me"/);
assert.match(hostedLauncher, /canvas_api_is_ready "http:\/\/localhost:3001\/api\/canvas\/v1\/readiness"/);
assert.match(hostedLauncher, /\^\(2\[0-9\]\[0-9\]\|401\)\$/);
assert.doesNotMatch(hostedLauncher, /local status\b/);
assert.doesNotMatch(hostedLauncher, /node_modules\/tsx\/dist\/cli\.mjs check-db-schema\.ts/);
assert.match(deployScript, /run\("npm", \["ci", "--include=dev", "--no-audit", "--no-fund"\], webRoot\)/);
assert.match(deployScript, /run\("npm", \["run", "audit:hosted:dependencies"\], webRoot\)/);
assert.match(deployScript, /runWithSanitizedViteEnvironment\("npm", \["run", "build:hosted"\]/);
assert.match(deployScript, /VITE_BASE: productionBase/);
assert.match(deployScript, /VITE_VISIONARY_PARENT_ORIGIN: productionParentOrigin/);
assert.match(deployScript, /git", \["ls-remote", "--exit-code", "--heads", remote, mergeRef\]/);
assert.match(deployScript, /remoteRevision !== localRevision/);
assert.match(deployScript, /assertPublicCspPrecondition\(\)/);
assert.match(deployScript, /assertCanvasCspHeaders\(headers, \{ requireBlob:/);
assert.match(deployScript, /\/api\/canvas\/v1\/readiness/);
assert.match(deployScript, /status !== "204"/);
assert.match(deployScript, /findPublicEntryScript\(publicIndex\)/);
assert.match(deployScript, /assertPublicBuildMetadata\(publicIndex, expectedManifest\)/);
assert.match(deployScript, /buildMetadataVersion: CURRENT_HOSTED_BUILD_METADATA_VERSION/);
assert.match(deployScript, /if \(!requiresCurrentHostedContract\(expectedManifest\)\) return/);
assert.match(deployScript, /if \(requiresCurrentHostedContract\(rollbackManifest\)\) assertPublicCspPrecondition\(\)/);
assert.match(deployScript, /if \(requiresCurrentHostedContract\(releaseManifest\)\) assertPublicCspPrecondition\(\)/);
assert.match(deployScript, /visionary-source-revision/);
assert.match(deployScript, /publicManifest\.version !== expectedManifest\.version/);
assert.match(deployScript, /publicManifest\.revision !== expectedManifest\.revision/);
assert.match(deployScript, /hostedBuildMetadataVersion\(publicManifest\) !== hostedBuildMetadataVersion\(expectedManifest\)/);
assert.match(deployScript, /const originalState = readRemoteReleaseState\(\)/);
assert.match(deployScript, /restoreRemoteReleaseState\(originalState, originalState\.previous\)/);
assert.match(deployScript, /restoreAfterFailedActivation\(originalState, releaseDir\)/);
assert.match(deployScript, /withRemoteDeployLock/);
assert.match(deployScript, /flock -n 9/);
assert.equal((deployScript.match(/await smokePublicDeployment\([^)]+\);\s*assertLockHeld\(\)/g) || []).length, 3);
assert.match(deployScript, /test ! -L "\$root"/);
assert.match(deployScript, /test "\$\(readlink -f "\$root"\)" = "\$root"/);
assert.match(deployScript, /actual_active=\$\(readlink -f "\$current"/);
assert.match(deployScript, /test "\$actual_active" = "\$expected_active"/);
assert.match(deployScript, /restored the original active and previous releases/);
assert.doesNotMatch(deployScript, /rollbackAfterFailedActivation/);
assert.match(deployScript, /assertProductionCanvasRemotePaths\(config\.releaseRoot, config\.currentPath\)/);
assert.match(deployScript, /releaseRoot !== productionReleaseRoot \|\| currentPath !== productionCurrentPath/);
assert.match(deployScript, /major === 22 && minor < 12/);
assert.match(hostedDistAudit, /asset must use the production root base/);
assert.match(hostedDistAudit, /references a missing or unsafe local asset/);
assert.match(hostedDistAudit, /Hosted build does not contain the requested parent origin/);
assert.match(viteConfig, /name: "visionary-hosted-build-metadata"/);
assert.match(viteConfig, /name: "visionary-source-revision"/);
assert.match(viteConfig, /envDir: visionaryHosted \? false : undefined/);
assert.match(dockerfile, /FROM node:22\.22\.0-alpine AS web-build/);
assert.match(dockerfile, /npm ci --include=dev --no-audit --no-fund/);
assert.match(dockerfile, /RUN npm run build/);
assert.doesNotMatch(dockerfile, /build:hosted|VITE_VISIONARY_HOSTED/);
assert.match(rootVercel, /npm ci --include=dev --no-audit --no-fund/);
assert.match(webVercel, /npm ci --include=dev --no-audit --no-fund/);
assert.doesNotMatch(rootVercel, /build:hosted|VITE_VISIONARY_HOSTED/);
assert.doesNotMatch(webVercel, /build:hosted|VITE_VISIONARY_HOSTED/);
assert.equal(packageManifest.packageManager, "npm@10.9.4");
assert.equal(packageManifest.engines?.node, ">=22.12.0 <23");
assert.equal(packageManifest.engines?.npm, ">=10.9.0 <11");
assert.match(dependencyAudit, /GHSA-qwww-vcr4-c8h2/);
assert.match(dependencyAudit, /allowedPackages = new Set\(\["react-router", "react-router-dom"\]\)/);
assert.match(dependencyAudit, /report\?\.error/);
assert.match(dependencyAudit, /!report\?\.metadata\?\.vulnerabilities/);

const validCspHeaders = "HTTP/2 200\r\nContent-Security-Policy: default-src 'self'; frame-ancestors https://visionary.beer; connect-src 'self' blob:\r\n";
assert.doesNotThrow(() => assertCanvasCspHeaders(validCspHeaders));
assert.doesNotThrow(() => assertCanvasCspHeaders("Content-Security-Policy: default-src 'self'; frame-ancestors https://visionary.beer; connect-src 'self'", { requireBlob: false }));
assert.throws(() => assertCanvasCspHeaders("Content-Security-Policy: frame-ancestors https://visionary.beer; connect-src 'self' blob:\r\nContent-Security-Policy: frame-ancestors 'none'; connect-src 'self'"), /exactly one Content-Security-Policy/);
assert.throws(() => assertCanvasCspHeaders("Content-Security-Policy: frame-ancestors 'none'; connect-src 'self' blob:"), /frame-ancestors/);
assert.throws(() => assertCanvasCspHeaders("Content-Security-Policy: frame-ancestors https://visionary.beer; connect-src 'self'"), /connect-src/);
assert.throws(() => assertCanvasCspHeaders("Content-Security-Policy: frame-ancestors 'none'; frame-ancestors https://visionary.beer; connect-src 'none'; connect-src 'self' blob:"), /repeats the frame-ancestors directive/);

const hostedProtocolVersion = Number(/VISIONARY_HOST_PROTOCOL_VERSION = (\d+) as const/.exec(hostedConstants)?.[1]);
assert.ok(Number.isInteger(hostedProtocolVersion));

const apiReadyFunction = /api_is_ready\(\) \{[\s\S]*?\n\}/.exec(hostedLauncher)?.[0];
assert.ok(apiReadyFunction);
const invokeApiReady = (status) =>
    spawnSync(
        "zsh",
        [
            "-fc",
            `
curl() { print -rn -- "$TEST_HTTP_STATUS"; }
${apiReadyFunction}
api_is_ready "http://localhost/api/auth/me"
`,
        ],
        { env: { ...process.env, TEST_HTTP_STATUS: status }, encoding: "utf8" },
    );
assert.equal(invokeApiReady("401").status, 0);
assert.equal(invokeApiReady("204").status, 0);
assert.notEqual(invokeApiReady("500").status, 0);

const canvasApiReadyFunction = /canvas_api_is_ready\(\) \{[\s\S]*?\n\}/.exec(hostedLauncher)?.[0];
assert.ok(canvasApiReadyFunction);
const invokeCanvasApiReady = (status) =>
    spawnSync(
        "zsh",
        [
            "-fc",
            `
curl() { print -rn -- "$TEST_HTTP_STATUS"; }
${canvasApiReadyFunction}
canvas_api_is_ready "http://localhost/api/canvas/v1/readiness"
`,
        ],
        { env: { ...process.env, TEST_HTTP_STATUS: status }, encoding: "utf8" },
    );
assert.equal(invokeCanvasApiReady("204").status, 0);
assert.notEqual(invokeCanvasApiReady("200").status, 0);
assert.notEqual(invokeCanvasApiReady("401").status, 0);
assert.notEqual(invokeCanvasApiReady("500").status, 0);

assert.equal(CURRENT_HOSTED_BUILD_METADATA_VERSION, 1);
assert.equal(hostedBuildMetadataVersion({ version: "legacy" }), 0);
assert.equal(requiresCurrentHostedContract({ version: "legacy" }), false);
assert.equal(requiresCurrentHostedContract({ buildMetadataVersion: 1 }), true);
assert.ok(Number.isNaN(hostedBuildMetadataVersion({ buildMetadataVersion: "invalid" })));
assert.ok(Number.isNaN(hostedBuildMetadataVersion({ buildMetadataVersion: "1" })));
assert.ok(Number.isNaN(hostedBuildMetadataVersion({ buildMetadataVersion: null })));
assert.ok(Number.isNaN(hostedBuildMetadataVersion({ buildMetadataVersion: 0 })));
assert.ok(Number.isNaN(hostedBuildMetadataVersion({ buildMetadataVersion: CURRENT_HOSTED_BUILD_METADATA_VERSION + 1 })));

const stateBuild = await build({
    entryPoints: [path.join(webRoot, "src/services/api/visionary-host/operation-state.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
});
const stateModule = await import(`data:text/javascript;base64,${Buffer.from(stateBuild.outputFiles[0].text).toString("base64")}`);
const baseRecord = {
    kind: "image",
    clientOperationId: "canvas:image:test",
    projectId: "project",
    nodeId: "result",
    status: "submitting",
    createdAt: 1_000,
    updatedAt: 1_000,
    notFoundCount: 2,
};
assert.equal(
    stateModule.isHostAdmissionBlocking(
        { ...baseRecord, admissionNodeId: "origin", admissionGroupId: "batch-a" },
        "origin",
        "batch-b",
    ),
    true,
);
assert.equal(
    stateModule.isHostAdmissionBlocking(
        { ...baseRecord, admissionNodeId: "origin", admissionGroupId: "batch-a" },
        "origin",
        "batch-a",
    ),
    false,
);
assert.equal(
    stateModule.isHostAdmissionBlocking(
        { ...baseRecord, admissionNodeId: "origin", admissionGroupId: "batch-a", status: "completed" },
        "origin",
        "batch-b",
    ),
    false,
);
assert.equal(
    stateModule.isHostAdmissionBlocking(
        { ...baseRecord, admissionNodeId: undefined, admissionGroupId: undefined },
        "result",
        "result",
    ),
    true,
);
assert.equal(stateModule.recoveryPatch({ operationId: baseRecord.clientOperationId, status: "not_found" }, baseRecord, baseRecord.createdAt + 119_999).status, "submitting");
assert.deepEqual(stateModule.recoveryPatch({ operationId: baseRecord.clientOperationId, status: "not_found" }, baseRecord, baseRecord.createdAt + 120_000), {
    status: "submitting",
    notFoundCount: 3,
});
assert.deepEqual(stateModule.recoveryPatch({ operationId: baseRecord.clientOperationId, status: "not_found" }, baseRecord, baseRecord.createdAt + 24 * 60 * 60_000 - 1), {
    status: "submitting",
    notFoundCount: 3,
});
assert.deepEqual(stateModule.recoveryPatch({ operationId: baseRecord.clientOperationId, status: "not_found" }, baseRecord, baseRecord.createdAt + 24 * 60 * 60_000), {
    status: "failed",
    error: "找不到对应的生图任务，原请求未扣除积分。",
    notFoundCount: 3,
});
assert.deepEqual(stateModule.recoveryPatch({ operationId: baseRecord.clientOperationId, status: "not_found" }, { ...baseRecord, notFoundCount: 1 }, baseRecord.createdAt + 24 * 60 * 60_000), {
    status: "submitting",
    notFoundCount: 2,
});
const pendingRecord = { ...baseRecord, status: "pending", generationId: "generation", notFoundCount: 2 };
assert.deepEqual(stateModule.recoveryPatch({ operationId: pendingRecord.clientOperationId, status: "not_found" }, pendingRecord, pendingRecord.createdAt + 119_999), {
    status: "pending",
    notFoundCount: 3,
});
assert.deepEqual(stateModule.recoveryPatch({ operationId: pendingRecord.clientOperationId, status: "not_found" }, pendingRecord, pendingRecord.createdAt + 120_000), {
    status: "failed",
    error: "找不到对应的生图任务，原请求未扣除积分。",
    notFoundCount: 3,
});
const preflightRecord = { ...baseRecord, status: "preflight", notFoundCount: undefined };
assert.deepEqual(stateModule.recoveryPatch({ operationId: preflightRecord.clientOperationId, status: "not_found" }, preflightRecord, preflightRecord.createdAt + 7 * 24 * 60 * 60_000), {
    status: "preflight",
    notFoundCount: undefined,
});
const guardedNodes = [
    { id: "origin", metadata: { status: "loading" } },
    { id: "target", metadata: { status: "loading", hostOperationId: "operation-preflight" } },
];
const clearedNodes = stateModule.clearHostedPreflightGuard(guardedNodes, "operation-preflight", "target", "origin");
assert.deepEqual(clearedNodes, [
    { id: "origin", metadata: { status: "idle", hostOperationId: undefined, errorDetails: undefined } },
    { id: "target", metadata: { status: "idle", hostOperationId: undefined, errorDetails: undefined } },
]);
assert.equal(guardedNodes[1].metadata.hostOperationId, "operation-preflight");
assert.deepEqual(
    [
        ...stateModule.buildHostedConfirmingNodeIds(
            [
                { id: "config" },
                { id: "root", metadata: { batchChildIds: ["child-a", "child-b"] } },
                { id: "child-a", metadata: { status: "loading", hostOperationId: "operation-a" } },
                { id: "child-b", metadata: { status: "idle" } },
                { id: "unrelated", metadata: { status: "loading" } },
            ],
            [
                { fromNodeId: "config", toNodeId: "root" },
                { fromNodeId: "root", toNodeId: "child-a" },
            ],
        ),
    ].sort(),
    ["child-a", "config", "root"],
);
assert.equal(
    stateModule.resolveHostedBatchStatus([
        { id: "failed", metadata: { status: "error" } },
        { id: "queued", metadata: { status: "idle" } },
    ]),
    "error",
);
assert.equal(
    stateModule.resolveHostedBatchStatus([
        { id: "failed", metadata: { status: "error" } },
        { id: "admitted", metadata: { status: "loading", hostOperationId: "operation-b" } },
    ]),
    "loading",
);
assert.equal(stateModule.shouldMarkTextRecoveryClientFailure(false, 401), true);
assert.equal(stateModule.shouldMarkTextRecoveryClientFailure(false, 409), true);
assert.equal(stateModule.shouldMarkTextRecoveryClientFailure(true, 401), false);
assert.equal(stateModule.shouldMarkTextRecoveryClientFailure(true, 403), false);
assert.equal(stateModule.shouldMarkTextRecoveryClientFailure(false, 500), false);
assert.equal(
    stateModule.hasHostedOperationConflict(
        ["root"],
        [{ id: "config" }, { id: "root", metadata: { batchChildIds: ["child"] } }, { id: "child", metadata: { status: "loading", hostOperationId: "operation" } }, { id: "unrelated" }],
        [{ fromNodeId: "config", toNodeId: "root" }],
        [],
    ),
    true,
);
assert.equal(
    stateModule.hasHostedOperationConflict(["foreground-origin"], [{ id: "foreground-origin" }, { id: "foreground-target" }], [], [{ originNodeId: "foreground-origin", targetNodeId: "foreground-target", runningNodeId: "foreground-origin" }]),
    true,
);
assert.equal(
    stateModule.hasHostedOperationConflict(["unrelated"], [{ id: "foreground-origin" }, { id: "foreground-target" }, { id: "unrelated" }], [], [{ originNodeId: "foreground-origin", targetNodeId: "foreground-target", runningNodeId: "foreground-origin" }]),
    false,
);

const testLocalForageState = new Map();
const testLocalStorageState = new Map();
let testLocalForageReadError = false;
let testLocalForageWriteError = false;
let testLocalForageRemoveError = false;
let testLocalStorageWriteError = false;
let testLocalForageSetCalls = 0;
let testLocalForageRemoveCalls = 0;
globalThis.__visionaryTestLocalForage = {
    config() {},
    async getItem(name) {
        if (testLocalForageReadError) throw new Error("idb read failed");
        return testLocalForageState.get(name) ?? null;
    },
    async setItem(name, value) {
        testLocalForageSetCalls += 1;
        if (testLocalForageWriteError) throw new Error("idb write failed");
        testLocalForageState.set(name, value);
        return value;
    },
    async removeItem(name) {
        testLocalForageRemoveCalls += 1;
        if (testLocalForageRemoveError) throw new Error("idb remove failed");
        testLocalForageState.delete(name);
    },
};
globalThis.window = {
    localStorage: {
        getItem(name) {
            return testLocalStorageState.get(name) ?? null;
        },
        setItem(name, value) {
            if (testLocalStorageWriteError) throw new Error("localStorage write failed");
            testLocalStorageState.set(name, String(value));
        },
        removeItem(name) {
            testLocalStorageState.delete(name);
        },
    },
};
const storageBuild = await build({
    entryPoints: [path.join(webRoot, "src/lib/localforage-storage.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
        {
            name: "hosted-storage-contract-stubs",
            setup(buildApi) {
                buildApi.onResolve({ filter: /^localforage$/ }, () => ({ path: "localforage", namespace: "storage-contract-localforage" }));
                buildApi.onLoad({ filter: /.*/, namespace: "storage-contract-localforage" }, () => ({
                    contents: "export default globalThis.__visionaryTestLocalForage;",
                    loader: "js",
                }));
                buildApi.onResolve({ filter: /^@\/constant\/visionary-hosted$/ }, () => ({ path: "visionary-hosted", namespace: "storage-contract-hosted" }));
                buildApi.onLoad({ filter: /^visionary-hosted$/, namespace: "storage-contract-hosted" }, () => ({
                    contents: "export const VISIONARY_HOSTED = true;",
                    loader: "js",
                }));
            },
        },
    ],
});
const storageModule = await import(`data:text/javascript;base64,${Buffer.from(storageBuild.outputFiles[0].text).toString("base64")}`);
const storageName = "host:test";
const storageOverrideName = `${storageName}:__local_override_v1`;

testLocalForageState.set(storageName, "idb-new");
testLocalStorageState.set(storageName, "legacy-old");
assert.equal(await storageModule.localForageStorage.getItem(storageName), "idb-new");

testLocalStorageState.set(storageName, "fallback-new");
testLocalStorageState.set(storageOverrideName, "1");
testLocalForageSetCalls = 0;
assert.equal(await storageModule.localForageStorage.getItem(storageName), "fallback-new");
assert.equal(testLocalForageSetCalls, 0);

testLocalStorageState.delete(storageOverrideName);
testLocalForageReadError = true;
await assert.rejects(storageModule.localForageStorage.getItem(storageName), /idb read failed/);
testLocalForageReadError = false;

testLocalForageWriteError = true;
await storageModule.localForageStorage.setItem(storageName, "fallback-durable");
assert.equal(testLocalStorageState.get(storageOverrideName), "1");
assert.equal(await storageModule.localForageStorage.getItem(storageName), "fallback-durable");
await storageModule.flushLocalForageStorageWrites();
testLocalStorageWriteError = true;
await assert.rejects(storageModule.localForageStorage.setItem(storageName, "not-durable"), /localStorage write failed/);
await assert.rejects(storageModule.flushLocalForageStorageWrites(), /localStorage write failed/);
testLocalStorageWriteError = false;
testLocalForageWriteError = false;

testLocalForageRemoveError = true;
await storageModule.localForageStorage.removeItem(storageName);
testLocalForageRemoveCalls = 0;
assert.equal(await storageModule.localForageStorage.getItem(storageName), null);
assert.equal(testLocalForageRemoveCalls, 0);
await storageModule.flushLocalForageStorageWrites();
testLocalForageRemoveError = false;
delete globalThis.__visionaryTestLocalForage;
delete globalThis.window;

console.log("Hosted runtime contract passed.");
