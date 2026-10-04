import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const memory = new Map();
const stores = new Map();
const notifications = new Map();
const requests = [];
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
};
globalThis.__deliveryTests = {
    storage: {
        createInstance({ storeName }) {
            if (!stores.has(storeName)) stores.set(storeName, new Map());
            const values = stores.get(storeName);
            return {
                async getItem(key) {
                    return values.get(key) || null;
                },
                async setItem(key, value) {
                    values.set(key, value);
                    return value;
                },
                async removeItem(key) {
                    values.delete(key);
                },
                async iterate(callback) {
                    for (const [key, value] of [...values]) callback(value, key);
                },
            };
        },
    },
    notifications,
};
const stubs = {
    localforage: "export default globalThis.__deliveryTests.storage;",
    "@/constant/visionary-hosted":
        "export const VISIONARY_HOSTED = true, VISIONARY_HOST_BILLING_EVENT = 'billing', VISIONARY_HOST_PROTOCOL_VERSION = 1, VISIONARY_HOST_SESSION_INVALID_EVENT = 'invalid', VISIONARY_RELEASE_VERSION = 'test'; export const normalizeHostedModel = x => x;",
    "@/services/image-storage": "export const getImageBlob = async () => null, resolveImageUrl = async () => '';",
    "@/lib/reference-image-compression": "export const prepareReferenceImageForUpload = async () => { throw Error('unused'); };",
    "@/stores/canvas/use-host-image-delivery-store":
        "export const getHostImageDelivery = id => globalThis.__deliveryTests.notifications.get(id), clearHostImageDelivery = id => globalThis.__deliveryTests.notifications.delete(id), setHostImageDelivery = entry => globalThis.__deliveryTests.notifications.set(entry.operationId, entry);",
};
async function bundle(contents, replacements = stubs, resolveDir = webRoot) {
    const result = await build({
        stdin: { contents, resolveDir, loader: "ts" },
        bundle: true,
        platform: "node",
        format: "esm",
        write: false,
        plugins: [
            {
                name: "fault-injection",
                setup(api) {
                    api.onResolve({ filter: /.*/ }, ({ path: importPath }) => {
                        if (replacements[importPath]) return { path: importPath, namespace: "stub" };
                        if (importPath.endsWith("/storage-namespace") || importPath === "./storage-namespace") return { path: "namespace", namespace: "stub" };
                    });
                    api.onLoad({ filter: /.*/, namespace: "stub" }, ({ path: importPath }) => ({
                        contents: importPath === "namespace" ? "export const visionaryHostStorageKey = key => 'account:' + key, isCurrentVisionaryHostStorageKey = key => key.startsWith('account:');" : replacements[importPath],
                        loader: "js",
                    }));
                },
            },
        ],
    });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + "\n//# sourceURL=hosted-image-delivery-test.mjs").toString("base64")}`);
}
const api = await bundle(
    `export * from './src/services/api/visionary-host/client'; export * from './src/services/api/visionary-host/operations'; export * from './src/services/api/visionary-host/image-delivery-queue'; export * from './src/services/api/visionary-host/image-delivery-state'; export * from './src/services/api/visionary-host/operation-state'; export * from './src/services/api/visionary-host/request-budget';`,
);
globalThis.window = new EventTarget();
globalThis.document = { cookie: "visionary_canvas_csrf=test" };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request: async (_name, _options, callback) => callback() } } });
let handleFetch;
globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return handleFetch(url, init);
};
const record = (id, status = "completed", projectId = "project") => ({ kind: "image", clientOperationId: id, nodeId: id, projectId, status, generationId: `generation-${id}`, imageUrl: `/media/${id}`, createdAt: Date.now(), updatedAt: Date.now() });

if (process.argv.includes("--compare-baseline")) {
    const oldSource = execFileSync("git", ["show", "d73a7d0cadfc247ce1d5b725ce88241e55a1f8bf:web/src/services/api/visionary-host/client.ts"], { cwd: webRoot, encoding: "utf8" });
    const baseline = await bundle(oldSource, stubs, path.join(webRoot, "src/services/api/visionary-host"));
    const blocked = deferred();
    await api.saveHostOperation(record("baseline-old", "completed", "baseline-project"));
    await api.saveHostOperation(record("baseline-new", "pending", "baseline-project"));
    let baselineReady = false;
    handleFetch = async () => Response.json({ results: [] });
    const baselineScan = baseline.recoverStoredVisionaryHostImages(
        "baseline-project",
        () => blocked.promise,
        undefined,
        () => {
            baselineReady = true;
        },
    );
    const result = await Promise.race([baselineScan.then(() => "finished"), new Promise((resolve) => setTimeout(() => resolve("blocked"), 50))]);
    assert.equal(result, "blocked");
    assert.equal(baselineReady, false);
    assert.equal(requests.length, 0);
    blocked.resolve(true);
    await baselineScan;
    requests.length = 0;
    console.log("Baseline production revision: while old media is unresolved, initial guard scan and new status request remain blocked.");
}

// An old download never resolves. The initial scan and every server-sized
// status batch must still finish, and the newly completed result gets a slot.
const old = deferred();
await api.saveHostOperation(record("old"));
for (let index = 0; index < 7; index++) await api.saveHostOperation(record(`active-${index}`, "pending"));
const order = [];
handleFetch = async (url, init) => {
    assert.ok(url.endsWith("/images/recover-batch"));
    const { operationIds } = JSON.parse(init.body);
    return Response.json({ results: operationIds.map((operationId) => ({ operationId, status: operationId === "active-6" ? "completed" : "pending", id: `generation-${operationId}` })) });
};
const scanStarted = performance.now();
const scan = await api.recoverStoredVisionaryHostImages(
    "project",
    (item) => {
        order.push(`delivery:${item.clientOperationId}`);
        return item.clientOperationId === "old" ? old.promise : true;
    },
    undefined,
    (_active, completed) => {
        order.push("guards-ready");
        assert.ok(completed.some((item) => item.clientOperationId === "old"));
    },
);
const scanElapsed = performance.now() - scanStarted;
assert.ok(scanElapsed < 500, "status scan should not wait on unresolved delivery");
console.log(`Updated recovery: initial guards and 7 status operations completed in ${scanElapsed.toFixed(1)} ms with old media still unresolved (in-memory fault scenario).`);
assert.equal(order[0], "guards-ready");
assert.equal(scan.activeCount, 6);
assert.deepEqual(
    requests.map(({ init }) => JSON.parse(init.body).operationIds.length),
    [6, 1],
);
await tick();
assert.ok(order.includes("delivery:active-6"));
assert.ok((await api.listHostOperations("project")).some((item) => item.clientOperationId === "old"));
assert.ok(!(await api.listHostOperations("project")).some((item) => item.clientOperationId === "active-6"));
old.resolve(true);
await tick();

// Local durable delivery is acknowledged before server ACK. A failed ACK
// keeps its durable marker so retry only repeats ACK, never image generation.
await api.saveHostOperation(record("ack", "completed", "ack-project"));
let ackAttempts = 0,
    localSaves = 0;
handleFetch = async (url) => {
    assert.ok(url.endsWith("/images/delivery-ack"));
    assert.equal(localSaves, 1);
    const saved = (await api.listHostOperations("ack-project"))[0];
    assert.ok(saved.localDeliveryCompletedAt);
    return ++ackAttempts === 1 ? Response.json({ error: "temporary" }, { status: 503 }) : Response.json({ ok: true });
};
await api.recoverStoredVisionaryHostImages(
    "ack-project",
    () => {
        localSaves++;
        return true;
    },
    undefined,
    undefined,
    true,
);
await tick();
await tick();
assert.equal((await api.listHostOperations("ack-project")).length, 1);
api.resetImageDeliveryRetry("ack");
await api.recoverStoredVisionaryHostImages(
    "ack-project",
    () => {
        localSaves++;
        return true;
    },
    undefined,
    undefined,
    true,
);
await tick();
await tick();
assert.equal(localSaves, 1);
assert.equal(ackAttempts, 2);
assert.equal((await api.listHostOperations("ack-project")).length, 0);

// Cancelling the owner while local delivery is pending must preserve recovery.
const cancelledDelivery = deferred();
const controller = new AbortController();
await api.saveHostOperation(record("cancelled", "completed", "cancel-project"));
await api.recoverStoredVisionaryHostImages("cancel-project", () => cancelledDelivery.promise, controller.signal);
controller.abort();
cancelledDelivery.resolve(true);
await tick();
assert.equal((await api.listHostOperations("cancel-project")).length, 1);

// Foreground completion and a stale background pending response can race.
// Per-operation writes must preserve the terminal state and settled billing.
await api.saveHostOperation(record("write-race", "pending", "race-project"));
await Promise.all([api.updateHostOperation("write-race", { status: "completed", billing: { state: "settled", chargedCredits: 20 } }), api.updateHostOperation("write-race", { status: "pending", billing: { state: "reserved", chargedCredits: 0 } })]);
const raced = (await api.listHostOperations("race-project"))[0];
assert.equal(raced.status, "completed");
assert.equal(raced.billing.chargedCredits, 20);
await Promise.all([api.acknowledgeHostOperation("write-race"), api.updateHostOperation("write-race", { status: "pending" })]);
assert.equal((await api.listHostOperations("race-project")).length, 0);

// A pending response captured before foreground completion must not publish
// its older reserved balance after the terminal record has already settled.
await api.saveHostOperation(record("billing-race", "pending", "billing-project"));
const staleBillingResponse = deferred();
const billingEvents = [];
const onBilling = (event) => billingEvents.push(event.detail);
window.addEventListener("billing", onBilling);
handleFetch = () => staleBillingResponse.promise;
const billingScan = api.recoverStoredVisionaryHostImages("billing-project", () => false);
await tick();
await api.updateHostOperation("billing-race", { status: "completed", billing: { state: "settled", chargedCredits: 20, remainingCredits: 80 } });
staleBillingResponse.resolve(Response.json({ credits: 100, results: [{ operationId: "billing-race", status: "pending", chargedCredits: 20 }] }));
await billingScan;
await tick();
window.removeEventListener("billing", onBilling);
assert.equal(billingEvents.length, 0, "ignored pending snapshots must not publish stale billing");
assert.equal((await api.listHostOperations("billing-project"))[0].billing.remainingCredits, 80);

// A late error cannot discard an already confirmed paid output either.
await api.saveHostOperation({ ...record("paid-terminal", "completed", "terminal-project"), billing: { state: "settled", chargedCredits: 20 } });
assert.equal(await api.updateHostOperation("paid-terminal", { status: "failed", error: "stale failure", billing: { state: "refunded", chargedCredits: 0 } }), false);
assert.equal((await api.listHostOperations("terminal-project"))[0].status, "completed");
assert.equal((await api.listHostOperations("terminal-project"))[0].billing.chargedCredits, 20);

for (const status of [200, 403]) {
    const posted = deferred(),
        staleFailure = deferred();
    const id = `paid-post-${status}`;
    handleFetch = () => {
        posted.resolve();
        return staleFailure.promise;
    };
    const request = api.requestVisionaryHostImage({ projectId: id, nodeId: id, clientOperationId: id }, "prompt", { model: "gpt-image-2" }, []);
    const protectedFailure = assert.rejects(request, (error) => error instanceof api.VisionaryHostOperationPendingError);
    await posted.promise;
    await api.updateHostOperation(id, { status: "completed", generationId: `generation-${id}`, imageUrl: `/media/${id}`, billing: { state: "settled", chargedCredits: 20 } });
    staleFailure.resolve(Response.json({ status: "failed", error: "stale failure" }, { status }));
    await protectedFailure;
    assert.equal((await api.listHostOperations(id))[0].status, "completed");
}

// A stalled project persistence barrier cannot ACK a paid output. Its late
// completion is ignored; an explicit retry must cross a fresh durable barrier.
const projectFlush = deferred();
await api.saveHostOperation(record("flush", "completed", "flush-project"));
const requestsBeforeFlush = requests.length;
await api.recoverStoredVisionaryHostImages(
    "flush-project",
    async () => {
        await api.withRequestBudget(undefined, 20, () => projectFlush.promise);
        return true;
    },
    undefined,
    undefined,
    true,
);
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal((await api.listHostOperations("flush-project")).length, 1);
assert.equal(requests.length, requestsBeforeFlush);
assert.equal(notifications.get("flush").status, "failed");
projectFlush.resolve(true);
await tick();
assert.equal(requests.length, requestsBeforeFlush);
handleFetch = async () => Response.json({ ok: true });
api.resetImageDeliveryRetry("flush");
await api.recoverStoredVisionaryHostImages("flush-project", () => true, undefined, undefined, true);
await tick();
await tick();
assert.equal((await api.listHostOperations("flush-project")).length, 0);

// Terminal projection releases generation guards for all queued media, keeps
// true pending children guarded, and never overwrites a newer operation.
const nodes = [
    { id: "source" },
    { id: "root", metadata: { status: "loading", batchChildIds: ["one", "two"] } },
    { id: "one", metadata: { status: "loading", hostOperationId: "old-one" } },
    { id: "two", metadata: { status: "loading", hostOperationId: "new-two" } },
];
let projected = api.markImagesAwaitingDelivery(nodes, [
    { nodeId: "one", clientOperationId: "old-one" },
    { nodeId: "two", clientOperationId: "old-two" },
]);
assert.equal(projected[2].metadata.hostImageDeliveryStatus, "pending");
assert.strictEqual(projected[3], nodes[3]);
assert.ok(api.buildHostedConfirmingNodeIds(projected, [{ fromNodeId: "source", toNodeId: "root" }]).has("source"));
projected = api.markImagesAwaitingDelivery(projected, [{ nodeId: "two", clientOperationId: "new-two" }]);
assert.equal(api.buildHostedConfirmingNodeIds(projected, [{ fromNodeId: "source", toNodeId: "root" }]).size, 0);
assert.equal(api.hostedPendingImageMetadata(new api.VisionaryHostOperationPendingError("unknown", "one")).status, "loading");
assert.equal(api.hostedPendingImageMetadata(new api.VisionaryHostImageDeliveryPendingError("paid", "one")).status, "error");

// Five actual delivery failures pause network retry; the user can resume
// the original delivery without refreshing or creating a new operation.
const originalNow = Date.now;
let testNow = originalNow();
Date.now = () => testNow;
let failedAttempts = 0;
const fiveFailures = record("five-failures", "completed", "five-project");
const failDelivery = async () => {
    failedAttempts++;
    notifications.set("five-failures", { status: "failed" });
    return false;
};
for (let attempt = 0; attempt < 6; attempt++) {
    api.scheduleImageDeliveries([fiveFailures], undefined, failDelivery);
    await tick();
    testNow += 100_000;
}
assert.equal(failedAttempts, 5);
api.resetImageDeliveryRetry("five-failures");
api.scheduleImageDeliveries([fiveFailures], undefined, async () => {
    failedAttempts++;
    return true;
});
await tick();
assert.equal(failedAttempts, 6);
assert.equal(notifications.has("five-failures"), false);
Date.now = originalNow;

// Shrink real production deadlines for tests. The server returns headers, then
// never finishes JSON. Deadline must cover body, abort fetch and retain guard.
const originalTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, ms, ...args) => originalTimeout(callback, ms >= 10_000 ? 20 : ms, ...args);
let timedOutSignal;
handleFetch = async (_url, init) => {
    timedOutSignal = init.signal;
    return new Response(
        new ReadableStream({
            start(stream) {
                stream.enqueue(new TextEncoder().encode('{"status":'));
            },
        }),
    );
};
await api.saveHostOperation(record("slow", "pending", "slow-project"));
let initialReady = false;
await assert.rejects(
    api.recoverStoredVisionaryHostImages(
        "slow-project",
        () => true,
        undefined,
        () => {
            initialReady = true;
        },
    ),
    { name: "TimeoutError" },
);
assert.equal(initialReady, true);
assert.ok(timedOutSignal.aborted);
assert.equal((await api.listHostOperations("slow-project"))[0].status, "pending");
const context = { projectId: "submit-project", nodeId: "submit", clientOperationId: "submit" };
const priorAdmissions = requests.filter(({ url }) => url.endsWith("/images")).length;
await assert.rejects(api.requestVisionaryHostImage(context, "prompt", { model: "gpt-image-2" }, []), (error) => error instanceof api.VisionaryHostOperationPendingError);
assert.equal((await api.listHostOperations("submit-project"))[0].status, "submitting");
assert.equal(requests.filter(({ url }) => url.endsWith("/images")).length, priorAdmissions + 1);
handleFetch = async (_url, init) => Response.json({ results: JSON.parse(init.body).operationIds.map((operationId) => ({ operationId, status: "completed", id: "original-generation" })) });
await api.recoverStoredVisionaryHostImages("submit-project", () => true);
await tick();
assert.equal((await api.listHostOperations("submit-project")).length, 0);
assert.equal(requests.filter(({ url }) => url.endsWith("/images")).length, priorAdmissions + 1);
globalThis.setTimeout = originalTimeout;

// A storage write that completes after timeout must be removed as an orphan;
// quota errors and non-image 200 bodies must never be accepted as saved output.
const lateWrite = deferred();
let storageMode = "late",
    removed = 0;
globalThis.__deliveryTests.storage = {
    createInstance() {
        return {
            async setItem(key, value) {
                if (storageMode === "quota") throw new DOMException("full", "QuotaExceededError");
                await lateWrite.promise;
                memory.set(key, value);
            },
            async removeItem(key) {
                removed++;
                memory.delete(key);
            },
        };
    },
};
const storageApi = await bundle("export * from './src/services/image-storage';", { ...stubs, "@/services/image-storage": undefined, "@/lib/image-utils": "export const readImageMeta = async () => ({ width: 100, height: 100, mimeType: 'image/png' });" });
await assert.rejects(storageApi.uploadImage(new Blob(["image"], { type: "image/png" }), { timeoutMs: 20 }), { name: "TimeoutError" });
lateWrite.resolve();
await tick();
assert.equal(memory.size, 0);
assert.equal(removed, 1);
storageMode = "quota";
await assert.rejects(storageApi.uploadImage(new Blob(["image"], { type: "image/png" }), { timeoutMs: 20 }), { name: "QuotaExceededError" });
handleFetch = async () => new Response("login page", { headers: { "Content-Type": "text/html" } });
await assert.rejects(storageApi.uploadImage("/media/paid", { timeoutMs: 100 }), /原图内容无效/);
handleFetch = async () => Response.json({ error: "session expired" }, { status: 401 });
await assert.rejects(storageApi.uploadImage("/media/paid", { timeoutMs: 100 }), /登录已失效/);
handleFetch = async () =>
    new Response(
        new ReadableStream({
            start(stream) {
                stream.enqueue(new Uint8Array([1]));
            },
        }),
        { headers: { "Content-Type": "image/png" } },
    );
await assert.rejects(storageApi.uploadImage("/media/paid", { timeoutMs: 20 }), { name: "TimeoutError" });
console.log("Hosted image delivery fault scenarios passed (stalled delivery, fair batches, durable ACK retry, cancellation, stale response, JSON/body timeout, single admission, late storage cleanup, quota, invalid media, session expiry).");
