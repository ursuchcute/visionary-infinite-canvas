import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stores = new Map(),
    requests = [];
let handler;
globalThis.__videoTests = {
    storage: {
        createInstance({ storeName }) {
            const values = new Map();
            stores.set(storeName, values);
            return {
                getItem: async (key) => values.get(key) || null,
                setItem: async (key, value) => {
                    values.set(key, structuredClone(value));
                    return value;
                },
                removeItem: async (key) => {
                    values.delete(key);
                },
                iterate: async (callback) => {
                    for (const [key, value] of [...values]) callback(structuredClone(value), key);
                },
            };
        },
    },
    refresh: 0,
};
const stubs = {
    localforage: "export default globalThis.__videoTests.storage;",
    "@/constant/visionary-hosted": `export const VISIONARY_HOSTED = true, VISIONARY_HOST_BILLING_EVENT = 'billing', VISIONARY_HOST_PROTOCOL_VERSION = 1, VISIONARY_HOST_SESSION_INVALID_EVENT = 'invalid', VISIONARY_RELEASE_VERSION = 'test'; export const normalizeHostedModel = value => value.split('::').at(-1).trim();`,
    "@/stores/use-visionary-host-store": "export const useVisionaryHostStore = {getState: () => ({refreshVideoConfiguration: async () => {globalThis.__videoTests.refresh++;}})};",
    "@/services/image-storage": 'export const getImageBlob = async () => globalThis.__videoTests.imageBlob || null, resolveImageUrl = async () => "";',
    "@/lib/reference-image-compression": 'export const prepareReferenceImageForUpload = async blob => { if(globalThis.__videoTests.compressionError) throw Error("compression failed"); return blob; };',
    "@/stores/canvas/use-host-image-delivery-store": "export const getHostImageDelivery = () => undefined, clearHostImageDelivery = () => {}, setHostImageDelivery = () => {};",
    react: "export const useCallback = x => x, useEffect = effect => { globalThis.__videoTests.effect = effect; }, useRef = current => ({current}), useState = initial => [initial, value => {globalThis.__videoTests.readyProject = value;}];",
};
const result = await build({
    stdin: {
        contents: `export * from './src/services/api/visionary-host/video'; export * from './src/services/api/visionary-host/reference-upload-transport'; export * from './src/services/api/visionary-host/client'; export * from './src/hosted/video-parameters'; export * from './src/pages/canvas/use-hosted-video-recovery';`,
        resolveDir: root,
        loader: "ts",
    },
    tsconfig: path.join(root, "tsconfig.json"),
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    define: { "import.meta.env.DEV": "true" },
    plugins: [
        {
            name: "faults",
            setup(api) {
                api.onResolve({ filter: /.*/ }, ({ path: p }) => {
                    if (stubs[p]) return { path: p, namespace: "stub" };
                    if (p.endsWith("/storage-namespace") || p === "./storage-namespace") return { path: "namespace", namespace: "stub" };
                });
                api.onLoad({ filter: /.*/, namespace: "stub" }, ({ path: p }) => ({
                    contents: p === "namespace" ? `export const visionaryHostStorageKey = key => 'account:' + key, isCurrentVisionaryHostStorageKey = key => key.startsWith('account:');` : stubs[p],
                    loader: "js",
                }));
            },
        },
    ],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
globalThis.window = new EventTarget();
globalThis.document = { cookie: "visionary_canvas_csrf=csrf" };
globalThis.fetch = async (url, init = {}) => {
    if (url.endsWith("/bootstrap")) return Response.json({ features: {}, user: { credits: 100 } });
    requests.push({ url, init });
    return handler(url, init);
};
const models = [
    {
        id: "minimax-h3",
        label: "H3",
        acceptingSubmissions: true,
        config: { resolutions: ["480p", "768p", "1080p"], aspectRatios: ["16:9", "9:16", "1:1"], durationMin: 1, durationMax: 15, max1080Duration: 10, imageMax: 9 },
        creditRules: ["480p", "768p", "1080p"].map((resolution) => ({ resolution, credits: 2, unit: "per_second" })),
    },
    {
        id: "grok-imagine-video-1.5",
        label: "Grok",
        acceptingSubmissions: true,
        config: { resolutions: ["480p", "720p", "1080p"], aspectRatios: ["16:9", "9:16", "1:1"], durationMin: 4, durationMax: 15, max1080Duration: 15, imageMax: 14 },
        creditRules: ["480p", "720p", "1080p"].map((resolution) => ({ resolution, credits: 3, unit: "per_second" })),
    },
];
const config = { model: "visionary-host::minimax-h3", videoModel: "visionary-host::minimax-h3", vquality: "1080p", size: "16:9", videoSeconds: "15" };
const context = (id) => ({ clientOperationId: `canvas_video_${id}`, projectId: "p", nodeId: "n" });
const task = (c, status = "queued", billingStatus = "reserved") => ({ id: "task-1", clientRequestId: c.clientOperationId, status, billingStatus, chargedCredits: 20 });
const pending = (promise) => assert.rejects(promise, (error) => error instanceof api.VisionaryHostOperationPendingError);
const rows = () => api.listHostedVideos("p");
const clear = () => {
    for (const store of stores.values()) store.clear();
    requests.length = 0;
};

let checks = 0;
function check(run) {
    run();
    checks++;
}
check(() => assert.deepEqual(api.resolveHostedVideoParameters(config, models).duration, 10));
check(() => assert.equal(api.resolveHostedVideoParameters({ ...config, videoSeconds: "0" }, models).duration, 6));
check(() => assert.equal(api.resolveHostedVideoParameters({ ...config, model: models[1].id, videoSeconds: "1" }, models).duration, 4));
check(() => assert.equal(api.resolveHostedVideoParameters({ ...config, model: models[1].id }, models, 1).resolution, "480p"));
check(() => assert.equal(api.resolveHostedVideoParameters({ ...config, model: models[1].id }, models, 2).resolutions.includes("1080p"), false));
check(() => assert.equal(api.resolveHostedVideoParameters(config, models).credits, 20));
check(() => assert.equal(api.resolveHostedVideoParameters(config, [{ ...models[0], creditRules: [{ resolution: "1080p", unit: "per_second", credits: 0 }] }]).credits, 0));
check(() => assert.equal(api.resolveHostedVideoParameters(config, [{ ...models[0], creditRules: [] }]).credits, null));
check(() => assert.equal(api.resolveHostedVideoParameters(config, [{ ...models[0], config: { ...models[0].config, resolutions: [] } }]), null));
check(() => assert.equal(api.resolveHostedVideoParameters({ ...config, model: "unsupported" }, models), null));
const c = context("normal_12345"),
    order = [];
handler = async (_url, init) => {
    order.push("POST");
    assert.equal(init.headers.get("x-canvas-csrf-token"), "csrf");
    assert.equal((await rows())[0].phase, "submitted");
    return Response.json({ task: task(c) }, { status: 202 });
};
await pending(
    api.submitHostedVideo(c, config, models, "hello", [], {
        onHostOperationTargetReady: async () => order.push("target"),
        onHostOperationDurable: async () => {
            assert.equal((await rows())[0].phase, "preflight");
            order.push("flush");
        },
    }),
);
check(() => assert.deepEqual(order, ["target", "flush", "POST"]));
let row = (await rows())[0];
handler = async () => Response.json({ task: task(c, "completed", "reserved") });
row = await api.recoverHostedVideo(row, new AbortController().signal);
check(() => assert.equal(api.hostedVideoNodeMetadata(row).status, "loading"));
handler = async () => Response.json({ task: task(c, "completed", "settled") });
row = await api.recoverHostedVideo(row, new AbortController().signal);
check(() => assert.equal(api.hostedVideoNodeMetadata(row).status, "success"));
check(() => assert.equal(api.hostedVideoNodeMetadata(row).content, "/api/canvas/v1/videos/tasks/task-1/content"));
await api.saveHostedVideoTask(row, task(c));
check(() => assert.equal(stores.get("visionary_host_video_operations").get("account:" + c.clientOperationId).task.status, "completed"));
handler = async (url, init) => {
    assert.ok(url.endsWith("/dismiss"));
    assert.equal(init.method, "POST");
    return Response.json({ ok: true });
};
await api.releaseHostedVideoSlot(row);
await api.removeHostedVideo(c.clientOperationId);
await api.saveHostedVideoTask(row, task(c));
check(() => assert.equal(stores.get("visionary_host_video_operations").size, 0));

clear();
const lost = context("lost_1234567");
let firstBody;
handler = async (_url, init) => {
    firstBody = init.body;
    throw Error("network response lost");
};
await pending(api.submitHostedVideo(lost, config, models, "immutable prompt", [], {}));
row = (await rows())[0];
check(() => assert.equal(row.phase, "submitted"));
handler = async (url, init) => {
    if (url.includes("/requests/")) return Response.json({ task: null });
    assert.equal(init.body, firstBody);
    return Response.json({ task: task(lost) }, { status: 202 });
};
row = await api.recoverHostedVideo(row, new AbortController().signal);
check(() => assert.equal(row.task.clientRequestId, lost.clientOperationId));
check(() => assert.equal(requests.filter((r) => r.init.method === "POST").length, 2));

clear();
const lookup = context("lookup_12345");
handler = async () => {
    throw Error("lost");
};
await pending(api.submitHostedVideo(lookup, config, models, "already accepted", [], {}));
row = (await rows())[0];
requests.length = 0;
handler = async () => Response.json({ task: task(lookup, "completed", "settled") });
await api.recoverHostedVideo(row, new AbortController().signal);
check(() =>
    assert.equal(
        requests.some((r) => r.init.method === "POST"),
        false,
    ),
);

for (const [status, code] of [
    [402, "insufficient_credits"],
    [409, "video_price_changed"],
    [409, "video_price_missing"],
    [429, "video_concurrency_limit"],
    [503, "video_submissions_disabled"],
]) {
    clear();
    let cleaned = false;
    handler = async () => Response.json({ error: "not admitted", code }, { status });
    await assert.rejects(
        api.submitHostedVideo(context(`reject_${status}_${code}`), config, models, "prompt", [], {
            onHostOperationPreflightFailed: async () => {
                cleaned = true;
            },
        }),
        api.VisionaryHostApiError,
    );
    check(() => assert.equal(cleaned, true));
    check(() => assert.equal(stores.get("visionary_host_video_operations").size, 0));
}
clear();
let sent = false;
handler = async () => {
    sent = true;
    return Response.json({});
};
await assert.rejects(
    api.submitHostedVideo(context("storage_123"), config, models, "prompt", [], {
        onHostOperationDurable: async () => {
            throw Error("disk full");
        },
    }),
    /disk full/,
);
check(() => assert.equal(sent, false));
check(() => assert.equal(stores.get("visionary_host_video_operations").size, 0));
const aborted = new AbortController();
aborted.abort();
await assert.rejects(api.submitHostedVideo(context("abort_12345"), config, models, "prompt", [], { signal: aborted.signal }), (error) => error.name === "AbortError");
check(() => assert.equal(sent, false));
await assert.rejects(api.submitHostedVideo(context("refs_123456"), config, models, "prompt", Array(10).fill({}), {}), /最多支持/);
check(() => assert.equal(sent, false));

// Reference preparation is part of durable preflight, never paid admission.
const signedUpload = `${api.HOSTED_REFERENCE_UPLOAD_ORIGIN}/ocoimage/video-references/test/reference.jpg?X-Amz-Signature=${"a".repeat(64)}`;
const reference = { storageKey: "reference", name: "reference.jpg" };
for (const stage of ["missing", "compression", "ticket", "network", "put", "complete"]) {
    clear();
    globalThis.__videoTests.imageBlob = stage === "missing" ? null : new Blob(["image"], { type: "image/jpeg" });
    globalThis.__videoTests.compressionError = stage === "compression";
    let cleaned = false;
    handler = async (url, init) => {
        if (url.endsWith("upload-url")) return stage === "ticket" ? Response.json({ error: "ticket failed" }, { status: 503 }) : Response.json({ id: "ref-1", uploadUrl: signedUpload, headers: { "Content-Type": "image/jpeg" } });
        if (init.method === "PUT") {
            if (stage === "network") throw new TypeError("Failed to fetch");
            return new Response(null, { status: stage === "put" ? 403 : 200 });
        }
        if (url.endsWith("/complete")) return Response.json({ error: "complete failed" }, { status: 400 });
        throw new Error("Unexpected paid submission");
    };
    await assert.rejects(
        api.submitHostedVideo(context(`upload_${stage}`), config, models, "prompt", [reference], {
            onHostOperationPreflightFailed: async () => {
                cleaned = true;
            },
        }),
    );
    check(() => assert.equal(cleaned, true));
    check(() => assert.equal(stores.get("visionary_host_video_operations").size, 0));
    check(() =>
        assert.equal(
            requests.some(({ url }) => url.includes("/models/")),
            false,
        ),
    );
}
globalThis.__videoTests.compressionError = false;
globalThis.__videoTests.imageBlob = new Blob(["image"], { type: "image/jpeg" });
clear();
const referenceOrder = [];
const referenceContext = context("uploaded_reference");
handler = async (url, init) => {
    if (url.endsWith("upload-url")) {
        referenceOrder.push("ticket");
        return Response.json({ id: "ref-1", uploadUrl: signedUpload, headers: { "Content-Type": "image/jpeg" } });
    }
    if (init.method === "PUT") {
        referenceOrder.push("put");
        assert.equal(url, api.videoReferenceUploadUrl(signedUpload, true));
        return new Response(null, { status: 200 });
    }
    if (url.endsWith("/complete")) {
        referenceOrder.push("complete");
        return Response.json({ url: "https://example.com/reference.jpg" });
    }
    referenceOrder.push("paid");
    assert.deepEqual(JSON.parse(init.body).referenceImages, ["https://example.com/reference.jpg"]);
    return Response.json({ task: task(referenceContext) }, { status: 202 });
};
await pending(
    api.submitHostedVideo(referenceContext, config, models, "prompt", [reference], {
        onHostOperationTargetReady: async () => referenceOrder.push("target"),
        onHostOperationDurable: async () => referenceOrder.push("durable"),
    }),
);
check(() => assert.deepEqual(referenceOrder, ["target", "durable", "ticket", "put", "complete", "paid"]));
const uploadedRows = await rows();
check(() => assert.deepEqual(uploadedRows[0].body.referenceImages, ["https://example.com/reference.jpg"]));
check(() => assert.equal(api.videoReferenceUploadUrl(signedUpload, false), signedUpload));
check(() => assert.equal(api.videoReferenceUploadUrl("https://another.example/upload", true), "https://another.example/upload"));
check(() => assert.throws(() => api.videoReferenceUploadUrl("http://localhost/upload", true), /地址无效/));

// Assert final Grok payloads after uploads, not just the picker capabilities.
// The initial durable preflight contains no uploaded URLs yet; its mode must
// already reflect the selected references and survive a lost POST response.
const grokPayloads = [];
for (const count of [0, 1, 2, 14]) {
    clear();
    const c = context(`grok_references_${count}`);
    const expectedMode = count === 0 ? "text" : count === 1 ? "image" : "reference";
    let completedUploads = 0;
    let sentBody;
    const resumedBodies = [];
    handler = async (url, init) => {
        if (url.endsWith("upload-url")) return Response.json({ id: `ref-${completedUploads}`, uploadUrl: signedUpload, headers: { "Content-Type": "image/jpeg" } });
        if (init.method === "PUT") return new Response(null, { status: 200 });
        if (url.endsWith("/complete")) return Response.json({ url: `https://example.com/reference-${completedUploads++}.jpg` });
        if (url.includes("/requests/")) return Response.json({ task: null });
        sentBody = JSON.parse(init.body);
        // Reject the incorrect text+images pairing as the actual API does.
        if (sentBody.mode !== expectedMode) return Response.json({ error: "reference mode mismatch" }, { status: 400 });
        resumedBodies.push(init.body);
        if (resumedBodies.length === 1) throw new TypeError("POST response lost");
        return Response.json({ task: task(c) }, { status: 202 });
    };
    await pending(
        api.submitHostedVideo(c, { ...config, model: models[1].id }, models, "Grok reference test", Array(count).fill(reference), {
            onHostOperationDurable: async () => {
                const [preflight] = await rows();
                assert.equal(preflight.body.mode, expectedMode);
                assert.deepEqual(preflight.body.referenceImages, []);
            },
        }),
    );
    const [record] = await rows();
    check(() => assert.equal(sentBody.mode, expectedMode));
    check(() => assert.equal(sentBody.referenceImages.length, count));
    check(() => assert.equal(completedUploads, count));
    check(() => assert.equal(sentBody.resolution, count ? "480p" : "1080p"));
    check(() => assert.equal(record.body.mode, expectedMode));
    await api.recoverHostedVideo(record, new AbortController().signal);
    check(() => assert.equal(resumedBodies[1], resumedBodies[0]));
    check(() => assert.equal(requests.filter(({ url }) => url.endsWith("upload-url")).length, count));
    grokPayloads.push(sentBody);
}
// Optional local cross-repository acceptance: export only these synthetic
// client bodies for the main site's real Grok parser, never session headers.
if (process.env.VISIONARY_VIDEO_PAYLOAD_FIXTURE_OUT) writeFileSync(process.env.VISIONARY_VIDEO_PAYLOAD_FIXTURE_OUT, JSON.stringify(grokPayloads, null, 2) + "\n");

for (const stage of ["cancel", "timeout"]) {
    clear();
    const controller = new AbortController();
    const savedTimeout = globalThis.setTimeout;
    if (stage === "timeout") globalThis.setTimeout = (fn, ms, ...args) => savedTimeout(fn, ms === 60_000 ? 20 : ms, ...args);
    let cleaned = false;
    handler = async (url, init) => {
        if (url.endsWith("upload-url")) return Response.json({ id: "ref-1", uploadUrl: signedUpload, headers: { "Content-Type": "image/jpeg" } });
        if (init.method === "PUT") {
            if (stage === "cancel") {
                controller.abort();
                throw new DOMException("Aborted", "AbortError");
            }
            return new Promise(() => {});
        }
        throw new Error("Unexpected completion or paid submission");
    };
    try {
        await assert.rejects(
            api.submitHostedVideo(context(`upload_${stage}`), config, models, "prompt", [reference], {
                signal: controller.signal,
                onHostOperationPreflightFailed: async () => {
                    cleaned = true;
                },
            }),
            (error) => error.name === (stage === "cancel" ? "AbortError" : "TimeoutError"),
        );
    } finally {
        globalThis.setTimeout = savedTimeout;
    }
    check(() => assert.equal(cleaned, true));
    check(() => assert.equal(stores.get("visionary_host_video_operations").size, 0));
    check(() =>
        assert.equal(
            requests.some(({ url }) => url.endsWith("/complete") || url.includes("/models/")),
            false,
        ),
    );
}

clear();
const stalled = context("stalled_body");
const originalTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => originalTimeout(fn, ms === 15_000 ? 20 : ms, ...args);
handler = async () => ({ ok: true, status: 202, json: () => new Promise(() => {}) });
try {
    await pending(api.submitHostedVideo(stalled, config, models, "prompt", [], {}));
} finally {
    globalThis.setTimeout = originalTimeout;
}
check(() => assert.equal(stores.get("visionary_host_video_operations").size, 1));

const completed = { ...(await rows())[0], task: task(stalled, "completed", "settled") };
const original = [{ id: "n", type: "video", title: "video", position: { x: 1, y: 2 }, width: 480, height: 270, metadata: { prompt: "edited while waiting", hostOperationId: stalled.clientOperationId, status: "loading" } }];
const applied = api.applyHostedVideoResult(original, completed);
check(() => assert.equal(applied[0].metadata.prompt, "edited while waiting"));
check(() => assert.equal(applied[0].metadata.status, "success"));
check(() => assert.strictEqual(api.applyHostedVideoResult(applied, completed), applied));
const changed = [{ ...original[0], metadata: { content: "user-owned.mp4", hostOperationId: "another" } }];
const recovered = api.applyHostedVideoResult(changed, { ...completed, body: { ...completed.body, aspectRatio: "9:16" } });
check(() => assert.equal(recovered.length, 2));
check(() => assert.equal(recovered[0].metadata.content, "user-owned.mp4"));
check(() => assert.equal(recovered[1].height, 420));
check(() => assert.strictEqual(api.applyHostedVideoResult(recovered, { ...completed, body: { ...completed.body, aspectRatio: "9:16" } }), recovered));
check(() => assert.equal(api.hostedVideoNodeMetadata({ ...completed, task: task(stalled, "failed", "reserved") }).status, "loading"));
check(() => assert.equal(api.hostedVideoNodeMetadata({ ...completed, task: task(stalled, "failed", "refunded") }).status, "error"));
check(() => assert.equal(api.hostedVideoNodeMetadata({ ...completed, task: task(stalled, "completed", "refunded") }).status, "error"));
await assert.rejects(api.saveHostedVideoTask(completed, { ...task(stalled), clientRequestId: "wrong" }), /身份不一致/);
// Execute the actual hook scanner with captured effects. Verify its durability
// barrier and lease cancellation separately from the pure graph projection.
const settle = async (predicate) => {
    for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw Error("scanner did not settle");
};
clear();
const hc = context("hook_flush_123");
const hr = { ...completed, ...hc, task: task(hc, "completed", "settled") };
stores.get("visionary_host_video_operations").set("account:" + hc.clientOperationId, structuredClone(hr));
const ref = { current: [{ ...original[0], metadata: { prompt: "keep", status: "loading", hostOperationId: hc.clientOperationId } }] };
let allowPersist = false,
    attempts = 0;
const events = [];
const persist = async (nodes) => {
    attempts++;
    if (!allowPersist) throw Error("quota");
    ref.current = nodes;
    events.push("flush");
};
handler = async (url) => {
    assert.ok(url.endsWith("/dismiss"));
    events.push("dismiss");
    return Response.json({ ok: true });
};
let hook = api.useHostedVideoRecovery("p", true, ref, persist);
let cleanup = globalThis.__videoTests.effect();
await settle(() => attempts > 0);
cleanup();
check(() => assert.equal(requests.length, 0));
check(() => assert.equal(stores.get("visionary_host_video_operations").size, 1));
allowPersist = true;
hook = api.useHostedVideoRecovery("p", true, ref, persist);
cleanup = globalThis.__videoTests.effect();
await settle(() => stores.get("visionary_host_video_operations").size === 0);
cleanup();
check(() => assert.equal(ref.current[0].metadata.status, "success"));
check(() => assert.deepEqual(events, ["flush", "flush", "dismiss"]));
check(() => assert.equal(globalThis.__videoTests.readyProject, "p"));
// Switching project/losing the lease while a request is pending must not
// apply the response, acknowledge the slot, or remove the durable record.
clear();
const lc = context("lease_abort_123");
const lr = { ...hr, ...lc, task: task(lc) };
stores.get("visionary_host_video_operations").set("account:" + lc.clientOperationId, structuredClone(lr));
let resolveLate,
    networkStarted = false;
handler = async () => {
    networkStarted = true;
    return new Promise((resolve) => {
        resolveLate = resolve;
    });
};
const leaseRef = { current: [{ ...original[0], metadata: { status: "loading", hostOperationId: lc.clientOperationId } }] };
api.useHostedVideoRecovery("p", true, leaseRef, async (nodes) => {
    leaseRef.current = nodes;
});
cleanup = globalThis.__videoTests.effect();
await settle(() => networkStarted);
cleanup();
resolveLate(Response.json({ task: task(lc, "completed", "settled") }));
await new Promise((resolve) => setTimeout(resolve, 10));
check(() => assert.equal(leaseRef.current[0].metadata.status, "loading"));
check(() => assert.equal(stores.get("visionary_host_video_operations").size, 1));
check(() =>
    assert.equal(
        requests.some((r) => r.url.endsWith("/dismiss")),
        false,
    ),
);
// A price rejection hidden by the lost original response must become a
// recoverable node error, rather than resubmitting the stale quote forever.
clear();
const priceLost = context("price_lost_123");
handler = async () => {
    throw Error("lost response");
};
await pending(api.submitHostedVideo(priceLost, config, models, "prompt", [], {}));
const priceRecord = (await rows())[0];
handler = async (url, init) => (url.includes("/requests/") ? Response.json({ task: null }) : Response.json({ error: "视频积分规则已更新", code: "video_price_changed" }, { status: 409 }));
const rejectedPrice = await api.recoverHostedVideo(priceRecord, new AbortController().signal);
check(() => assert.equal(rejectedPrice.phase, "failed"));
check(() => assert.equal(api.hostedVideoNodeMetadata(rejectedPrice).status, "error"));
check(() => assert.equal(stores.get("visionary_host_video_operations").get("account:" + priceLost.clientOperationId).phase, "failed"));
// Expired browser-only admission cannot silently start a paid job on reopen.
clear();
const stale = context("stale_123456");
handler = async () => {
    throw Error("lost");
};
await pending(api.submitHostedVideo(stale, config, models, "prompt", [], {}));
const staleRecord = { ...(await rows())[0], createdAt: Date.now() - 2 * 60 * 60 * 1000 - 1 };
requests.length = 0;
handler = async () => Response.json({ task: null });
const expiredAdmission = await api.recoverHostedVideo(staleRecord, new AbortController().signal);
check(() => assert.equal(expiredAdmission.phase, "failed"));
check(() =>
    assert.equal(
        requests.some((request) => request.init.method === "POST"),
        false,
    ),
);
// Two task completions can refresh credits in reverse response order.
// Only the most recently requested balance may reach the parent/store event.
await new Promise((resolve) => setTimeout(resolve, 10));
const normalFetch = globalThis.fetch,
    balances = [],
    replies = [];
window.addEventListener("billing", (event) => balances.push(event.detail.remainingCredits));
globalThis.fetch = async () => new Promise((resolve) => replies.push(resolve));
const early = api.refreshVisionaryHostCredits("settled"),
    latest = api.refreshVisionaryHostCredits("settled");
await settle(() => replies.length === 2);
replies[1](Response.json({ features: {}, user: { credits: 70 } }));
await latest;
replies[0](Response.json({ features: {}, user: { credits: 99 } }));
await early;
globalThis.fetch = normalFetch;
check(() => assert.deepEqual(balances, [70]));
// Execute the real hosted/config stores through disabled -> enabled -> renewed
// video catalogs. Existing image/text drafts must survive every transition.
const catalogStubs = {
    "@/services/api/visionary-host/session": "export const startVisionaryHostSession = async callbacks => { globalThis.__videoTests.session = callbacks; await callbacks.onBootstrap(globalThis.__videoTests.bootstrap); return () => {}; };",
    "@/services/api/visionary-host/client": "export const refreshVisionaryHostCredits = async () => globalThis.__videoTests.bootstrap;",
    "@/services/api/visionary-host/storage-namespace": "export const setVisionaryHostStorageNamespace = () => {};",
    "@/stores/canvas/use-canvas-store": "export const useCanvasStore = {persist:{rehydrate:async()=>{}}};",
    "@/stores/use-asset-store": "export const useAssetStore = {persist:{rehydrate:async()=>{}}};",
    "@/stores/use-prompt-store": "export const usePromptStore = {persist:{rehydrate:async()=>{}}};",
};
const catalogBundle = await build({
    stdin: { contents: "export * from './src/stores/use-visionary-host-store'; export * from './src/hosted/config-store';", resolveDir: root, loader: "ts" },
    tsconfig: path.join(root, "tsconfig.json"),
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [
        {
            name: "catalog-fixture",
            setup(builder) {
                builder.onResolve({ filter: /.*/ }, ({ path: name }) => (name === "@/stores/use-config-store" ? { path: path.join(root, "src/hosted/config-store.ts") } : catalogStubs[name] ? { path: name, namespace: "catalog" } : undefined));
                builder.onLoad({ filter: /.*/, namespace: "catalog" }, ({ path: name }) => ({ contents: catalogStubs[name], loader: "js" }));
            },
        },
    ],
});
const catalog = await import(`data:text/javascript;base64,${Buffer.from(catalogBundle.outputFiles[0].text).toString("base64")}`);
globalThis.__videoTests.bootstrap = {
    protocolVersion: 1,
    storageNamespace: "catalog",
    features: { image: true, text: true, video: false },
    image: { models: [{ id: "nano-banana-2" }], defaultModel: "nano-banana-2" },
    text: { models: [{ key: "chat-pro" }], defaultModel: "chat-pro" },
    video: { models: [], defaultModel: "minimax-h3" },
    user: { credits: 100 },
};
await catalog.useVisionaryHostStore.getState().initialize();
const draft = { ...catalog.useConfigStore.getState().config, size: "9:16", imageResolution: "2k", quality: "high", count: "5", systemPrompt: "keep my text draft" };
catalog.useConfigStore.setState({ config: draft });
globalThis.__videoTests.bootstrap = { ...globalThis.__videoTests.bootstrap, features: { image: true, text: true, video: true }, video: { models, defaultModel: "minimax-h3" } };
await catalog.useVisionaryHostStore.getState().refreshVideoConfiguration();
let configured = catalog.useConfigStore.getState().config;
check(() => assert.equal(configured.channels[0].models.filter((m) => m.capability === "video").length, 2));
for (const key of ["imageModel", "textModel", "model", "size", "imageResolution", "quality", "count", "systemPrompt"]) check(() => assert.equal(configured[key], draft[key]));
globalThis.__videoTests.bootstrap = { ...globalThis.__videoTests.bootstrap, video: { models: [models[0]], defaultModel: "minimax-h3" } };
await globalThis.__videoTests.session.onBootstrap(globalThis.__videoTests.bootstrap);
configured = catalog.useConfigStore.getState().config;
check(() => assert.equal(configured.channels[0].models.filter((m) => m.capability === "video").length, 1));
check(() => assert.equal(configured.imageResolution, "2k"));
check(() => assert.equal(configured.systemPrompt, "keep my text draft"));
// Switching Config video/image/text modes must submit the same valid family
// that its picker displays, including imported nodes with stale model fields.
const generationSource = readFileSync(path.join(root, "src/lib/canvas/canvas-generation-helpers.ts"), "utf8");
const generationAst = ts.createSourceFile("generation.ts", generationSource, ts.ScriptTarget.Latest, true);
const buildConfigSource = generationAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "buildGenerationConfig").getText(generationAst);
const generationBundle = await build({
    stdin: {
        contents: `
import { defaultConfig, modelMatchesCapability } from './src/hosted/config-store';
const VISIONARY_HOSTED=true;
const resolveCanvasImageAspectRatios=()=>[],resolveCanvasImageParameters=()=>null,shouldUseStandardCanvasImageResolution=()=>false,resolveCanvasImageRequestResolution=()=>'',resolveCanvasImageSize=()=>'',shouldHideCanvasImageQuality=()=>false;
${buildConfigSource}
`,
        resolveDir: root,
        loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
});
const generation = await import(`data:text/javascript;base64,${Buffer.from(generationBundle.outputFiles[0].text).toString("base64")}`);
check(() => assert.equal(generation.buildGenerationConfig(configured, { metadata: { model: "visionary-host::minimax-h3" } }, "image").model, configured.imageModel));
check(() => assert.equal(generation.buildGenerationConfig(configured, { metadata: { model: configured.imageModel } }, "video").model, configured.videoModel));
check(() => assert.equal(generation.buildGenerationConfig(configured, { metadata: { model: "visionary-host::minimax-h3" } }, "text").model, configured.textModel));
check(() => assert.equal(generation.buildGenerationConfig(configured, { metadata: { model: configured.imageModel } }, "image").model, configured.imageModel));
// Run the real page's generic failure mapper: an empty video target can be
// the source itself, while an existing image source must retain its result.
const projectAst = ts.createSourceFile("project.tsx", readFileSync(path.join(root, "src/pages/canvas/project.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let failureMap;
function findFailureMap(node) {
    if (ts.isCallExpression(node) && node.expression.getText(projectAst) === "prev.map" && node.getText(projectAst).includes("pendingChildIds.includes(node.id)") && node.getText(projectAst).includes("markSourceStatus")) failureMap = node;
    ts.forEachChild(node, findFailureMap);
}
findFailureMap(projectAst);
assert.ok(failureMap, "actual page failure mapper must be tested");
const failedPage = ts.transpileModule(`const NODE_STATUS_ERROR='error'; export function apply(prev, nodeId, pendingChildIds, markSourceStatus, errorDetails) { return ${failureMap.getText(projectAst)}; }`, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const failedNodes = await import(`data:text/javascript;base64,${Buffer.from(failedPage.outputText).toString("base64")}`);
const emptyVideo = { id: "video", metadata: { status: "loading", prompt: "keep prompt" } };
const imageSource = { id: "image", metadata: { status: "success", content: "keep image" } };
const videoFailure = failedNodes.apply([emptyVideo, imageSource], "video", ["video"], false, "upload failed");
check(() => assert.equal(videoFailure[0].metadata.status, "error"));
check(() => assert.equal(videoFailure[0].metadata.prompt, "keep prompt"));
check(() => assert.equal(videoFailure[1], imageSource));
const childFailure = failedNodes.apply([imageSource, emptyVideo], "image", ["video"], false, "upload failed");
check(() => assert.equal(childFailure[0], imageSource));
check(() => assert.equal(childFailure[1].metadata.status, "error"));
console.log(`Hosted video: ${checks} assertions passed (real client/API/storage/recovery/graph functions; no paid upstream calls).`);
