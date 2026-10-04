import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectSource = readFileSync(path.join(webRoot, "src/pages/canvas/project.tsx"), "utf8");
const ast = ts.createSourceFile("project.tsx", projectSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
let persistCallback, deliveryCallback;
function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "persistHostedRecoveryNodes") persistCallback = node.initializer.arguments[0].getText(ast);
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "recoverStoredVisionaryHostImages") deliveryCallback = node.arguments[1].getText(ast);
    ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(persistCallback && deliveryCallback, "test must execute the current page's actual recovery callbacks");

const storage = new Map();
let writeBarrier = null,
    storageFailure = null;
globalThis.__recoveryGraphTests = {
    async getItem(key) {
        return storage.get(key) || null;
    },
    async setItem(key, value) {
        if (writeBarrier) await writeBarrier;
        if (storageFailure) throw storageFailure;
        storage.set(key, value);
    },
    async removeItem(key) {
        storage.delete(key);
    },
};
const replacements = {
    "@/constant/visionary-hosted": "export const VISIONARY_HOSTED = true;",
    "@/lib/localforage-storage": "export const localForageStorage = globalThis.__recoveryGraphTests;",
    "@/services/api/visionary-host/storage-namespace": "export const visionaryHostStorageKey = key => 'account:' + key;",
    "./storage-namespace": "export const visionaryHostStorageKey = key => 'account:' + key;",
    "@/services/canvas-project-cover": "export const deleteCanvasProjectCovers = async () => {}, ensureCanvasProjectCover = async () => {};",
};
const result = await build({
    stdin: {
        resolveDir: webRoot,
        loader: "ts",
        contents: `
            import { VISIONARY_HOSTED } from '@/constant/visionary-hosted';
            import { useCanvasStore, flushCanvasStorePersistence } from './src/stores/canvas/use-canvas-store';
            import { useHostImageDeliveryStore, setHostImageDelivery } from './src/stores/canvas/use-host-image-delivery-store';
            import { withRequestBudget } from './src/services/api/visionary-host/request-budget';
            import { markImageAwaitingDelivery } from './src/services/api/visionary-host/image-delivery-state';
            import { resolveHostedBatchStatus } from './src/services/api/visionary-host/operation-state';
            import { imageMetadata } from './src/lib/canvas/canvas-node-factory';
            import { fitNodeSize } from './src/lib/canvas/canvas-node-size';
            import { NODE_DEFAULT_SIZE } from './src/constant/canvas';
            import { CanvasNodeType } from './src/types/canvas';
            const NODE_STATUS_ERROR = 'error', NODE_STATUS_SUCCESS = 'success';
            ${functions.get("syncConnectedConfigStatus")}
            ${functions.get("recoveredHostedNodeId")}
            ${functions.get("recoveredHostedNodePosition")}
            export { useCanvasStore, flushCanvasStorePersistence, useHostImageDeliveryStore };
            export function createDelivery(env) {
                const { projectId, nodesRef, connectionsRef, generationRequestsRef, controller, hostProjectLeaseRef, setNodes, updateProject, uploadImage, getImageBlob, message } = env;
                const persistHostedRecoveryNodes = ${persistCallback};
                return ${deliveryCallback};
            }
        `,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [
        {
            name: "local-boundaries",
            setup(api) {
                api.onResolve({ filter: /.*/ }, ({ path: importPath }) => (replacements[importPath] ? { path: importPath, namespace: "stub" } : undefined));
                api.onLoad({ filter: /.*/, namespace: "stub" }, ({ path: importPath }) => ({ contents: replacements[importPath], loader: "js" }));
            },
        },
    ],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
await api.useCanvasStore.persist.rehydrate();
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const node = (id, operationId = id) => ({ id, type: "image", position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { status: "loading", hostOperationId: operationId, prompt: `prompt-${id}` } });
const record = (id, nodeId = id) => ({ kind: "image", status: "completed", clientOperationId: id, nodeId, generationId: `generation-${id}`, imageUrl: `/media/${id}`, billing: { chargedCredits: 20 } });
const image = (id) => ({ url: `blob:${id}`, storageKey: `stored-${id}`, width: 640, height: 480, bytes: 123, mimeType: "image/png" });
function harness(nodes) {
    const projectId = api.useCanvasStore.getState().importProject({ nodes });
    const downloads = new Map(),
        blobs = new Map();
    const env = {
        projectId,
        nodesRef: { current: nodes },
        connectionsRef: { current: [] },
        generationRequestsRef: { current: new Map() },
        controller: new AbortController(),
        hostProjectLeaseRef: { current: { projectId, owned: true } },
        updateProject: api.useCanvasStore.getState().updateProject,
        setNodes(update) {
            env.nodesRef.current = typeof update === "function" ? update(env.nodesRef.current) : update;
        },
        async uploadImage(url) {
            const id = url.split("/").at(-1);
            const gate = deferred();
            downloads.set(id, gate);
            const uploaded = await gate.promise;
            blobs.set(uploaded.storageKey, new Blob(["image"], { type: "image/png" }));
            return uploaded;
        },
        async getImageBlob(key) {
            return blobs.get(key) || null;
        },
        message: { success() {} },
    };
    const deliver = api.createDelivery(env);
    const durableNodes = () => JSON.parse(storage.get("account:infinite-canvas:canvas_store")).state.projects.find((project) => project.id === projectId).nodes;
    return { env, deliver, downloads, blobs, durableNodes };
}

// Complete two real page callbacks in reverse order while IndexedDB is busy.
// Both outputs must survive in the newest durable graph and keep their prompts.
const concurrent = harness([node("first"), node("second")]);
const persistGate = deferred();
writeBarrier = persistGate.promise;
const first = concurrent.deliver(record("first")),
    second = concurrent.deliver(record("second"));
await tick();
concurrent.downloads.get("second").resolve(image("second"));
await tick();
concurrent.downloads.get("first").resolve(image("first"));
await tick();
assert.deepEqual(
    concurrent.env.nodesRef.current.map((item) => item.metadata.content),
    ["blob:first", "blob:second"],
);
persistGate.resolve();
writeBarrier = null;
assert.deepEqual(await Promise.all([first, second]), [true, true]);
assert.deepEqual(
    concurrent.durableNodes().map((item) => item.metadata.prompt),
    ["prompt-first", "prompt-second"],
);
assert.deepEqual(
    concurrent.durableNodes().map((item) => item.metadata.content),
    ["blob:first", "blob:second"],
);

// A new operation takes the original target during a download. Preserve it
// and recover the paid old output into exactly one separate durable node.
const conflict = harness([node("target", "old")]);
const old = conflict.deliver(record("old", "target"));
await tick();
conflict.env.nodesRef.current = [node("target", "new")];
conflict.downloads.get("old").resolve(image("old"));
assert.equal(await old, true);
assert.equal(conflict.durableNodes()[0].metadata.hostOperationId, "new");
assert.equal(conflict.durableNodes()[0].metadata.content, undefined);
assert.equal(conflict.durableNodes()[1].id, "host-recovered-image:old");

// Deleted target + storage quota failure keeps the result recoverable. Once
// storage works, retry persists the existing fallback without another download.
const deleted = harness([node("deleted")]);
const deletedDelivery = deleted.deliver(record("deleted"));
await tick();
deleted.env.nodesRef.current = [];
storageFailure = new DOMException("full", "QuotaExceededError");
deleted.downloads.get("deleted").resolve(image("deleted"));
assert.equal(await deletedDelivery, false);
assert.equal(api.useHostImageDeliveryStore.getState().entries.deleted.status, "failed");
storageFailure = null;
assert.equal(await deleted.deliver(record("deleted")), true);
assert.equal(deleted.downloads.size, 1);
assert.equal(deleted.durableNodes().length, 1);

// Project switch cancels an outstanding delivery, including an adapter whose
// promise ignores abort. A late output must not enter either project's graph.
const switched = harness([node("switch")]);
await api.flushCanvasStorePersistence();
const beforeSwitch = JSON.stringify(switched.durableNodes());
const switchDelivery = switched.deliver(record("switch"));
await tick();
switched.env.controller.abort();
switched.env.hostProjectLeaseRef.current = { projectId: "another-project", owned: false };
switched.downloads.get("switch").resolve(image("switch"));
assert.equal(await switchDelivery, false);
assert.equal(JSON.stringify(switched.durableNodes()), beforeSwitch);
assert.equal(switched.env.nodesRef.current[0].metadata.content, undefined);

// Losing the editing lease or deleting the project forbids durable delivery.
const lostLease = harness([node("lease")]);
const leaseDelivery = lostLease.deliver(record("lease"));
await tick();
lostLease.env.hostProjectLeaseRef.current.owned = false;
lostLease.downloads.get("lease").resolve(image("lease"));
assert.equal(await leaseDelivery, false);
assert.equal(lostLease.env.nodesRef.current[0].metadata.content, undefined);
const gone = harness([node("gone")]);
const goneDelivery = gone.deliver(record("gone"));
await tick();
api.useCanvasStore.getState().deleteProjects([gone.env.projectId]);
gone.downloads.get("gone").resolve(image("gone"));
assert.equal(await goneDelivery, false);
assert.ok(!api.useCanvasStore.getState().projects.some((project) => project.id === gone.env.projectId));

// Failed old operations never overwrite newer targets, and foreground-owned
// requests do not acquire a competing background download.
const newer = harness([node("newer", "new-op")]);
assert.equal(await newer.deliver({ ...record("old-op", "newer"), status: "failed", error: "old failure" }), true);
assert.equal(newer.env.nodesRef.current[0].metadata.hostOperationId, "new-op");
const foreground = harness([node("foreground")]);
foreground.env.generationRequestsRef.current.set("foreground", {});
assert.equal(await foreground.deliver(record("foreground")), false);
assert.equal(foreground.downloads.size, 0);
await api.flushCanvasStorePersistence();
// A fresh store module hydrates only the persisted snapshot, as on page reload.
const refreshedApi = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + "\n// fresh-page-module").toString("base64")}`);
await refreshedApi.useCanvasStore.persist.rehydrate();
const reloaded = refreshedApi.useCanvasStore.getState().projects;
assert.deepEqual(
    reloaded.find((project) => project.id === concurrent.env.projectId).nodes.map((item) => item.metadata.content),
    ["blob:first", "blob:second"],
);
assert.equal(reloaded.find((project) => project.id === conflict.env.projectId).nodes[0].metadata.hostOperationId, "new");
assert.equal(reloaded.find((project) => project.id === deleted.env.projectId).nodes.length, 1);
console.log("Actual page recovery + canvas persistence passed: concurrent reverse completion, target reuse, deleted target, quota retry, project switch, lease loss, deleted project, failed old operation, foreground ownership.");
