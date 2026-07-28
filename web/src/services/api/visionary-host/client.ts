import localforage from "localforage";

import { getImageBlob, resolveImageUrl } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";
import {
    VISIONARY_HOST_BILLING_EVENT,
    VISIONARY_HOST_PROTOCOL_VERSION,
    VISIONARY_HOST_SESSION_INVALID_EVENT,
    VISIONARY_RELEASE_VERSION,
    normalizeHostedModel,
} from "@/constant/visionary-hosted";
import { prepareReferenceImageForUpload } from "@/lib/reference-image-compression";

import {
    acknowledgeHostOperation,
    isHostAdmissionBlocking,
    listHostOperations,
    listHostTextOperations,
    recoveryPatch,
    saveHostOperation,
    saveHostTextOperation,
    shouldMarkTextRecoveryClientFailure,
    updateHostOperation,
    updateHostTextOperation,
    type VisionaryHostOperationRecord,
    type VisionaryHostTextOperationRecord,
} from "./operations";
import { visionaryHostStorageKey } from "./storage-namespace";
import type {
    VisionaryHostBilling,
    VisionaryHostBootstrap,
    VisionaryHostExchangeResponse,
    VisionaryHostImageDeliveryAckRequest,
    VisionaryHostImageDeliveryAckResponse,
    VisionaryHostImageQuote,
    VisionaryHostImageRecoveryResponse,
    VisionaryHostImageRequest,
    VisionaryHostImageResponse,
    VisionaryHostRequestContext,
    VisionaryHostSseFrame,
    VisionaryHostTextCapabilities,
    VisionaryHostTextConversation,
    VisionaryHostTextRun,
} from "./contracts";

const HOST_API_ROOT = "/api/canvas/v1";
const HOST_CSRF_COOKIE = "visionary_canvas_csrf";
const MAX_HOST_REFERENCE_IMAGES = 9;
const MAX_HOST_REFERENCE_TOTAL_BYTES = 30 * 1024 * 1024;
// Keep client recovery requests within the server's bounded recovery batch.
// The server intentionally accepts at most six operation IDs per request so
// one noisy browser cannot turn recovery into an unbounded database query.
export const HOST_IMAGE_RECOVERY_BATCH_LIMIT = 6;
const HOST_OPERATION_PREFLIGHT_GRACE_MS = 2 * 60_000;
const HOST_IMAGE_DELIVERY_ACK_TIMEOUT_MS = 10_000;
const preparedReferenceBlobs = new WeakMap<ReferenceImage, Map<number, Promise<Blob>>>();
const textConversationStore = localforage.createInstance({
    name: "infinite-canvas",
    storeName: "visionary_host_text_conversations",
});

type StoredTextConversation = {
    conversationId: string;
    modelKey: string;
};

type HostImageParameters = {
    model: string;
    ratio?: string;
    imageSize?: string;
    quality?: string;
    optimizeChineseText?: boolean;
};

type HostOperationRequestOptions = {
    signal?: AbortSignal;
    hostAdmissionNodeId?: string;
    hostAdmissionGroupId?: string;
    onHostOperationTargetReady?: (context: VisionaryHostRequestContext) => Promise<void>;
    onHostOperationDurable?: (context: VisionaryHostRequestContext) => Promise<void>;
    onHostOperationPreflightFailed?: (context: VisionaryHostRequestContext) => Promise<void>;
};

export class VisionaryHostApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "VisionaryHostApiError";
    }
}

export class VisionaryHostOperationPendingError extends Error {
    constructor(
        readonly operationId: string,
        readonly nodeId: string,
        message = "任务已提交，正在确认服务端状态，请勿重复生成。",
    ) {
        super(message);
        this.name = "VisionaryHostOperationPendingError";
    }
}

export class VisionaryHostPreflightCancelledError extends Error {
    constructor(
        readonly operationId: string,
        readonly nodeId: string,
    ) {
        super("请求已取消");
        this.name = "VisionaryHostPreflightCancelledError";
    }
}

export class VisionaryHostAdmissionBlockedError extends Error {
    constructor(
        readonly blockingOperationId: string,
        readonly blockingNodeId: string,
        readonly requestedNodeId: string,
    ) {
        super("该节点已有任务正在生成或确认，请勿重复提交。");
        this.name = "VisionaryHostAdmissionBlockedError";
    }
}

class VisionaryHostPreDispatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "VisionaryHostPreDispatchError";
    }
}

class VisionaryHostTerminalOperationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "VisionaryHostTerminalOperationError";
    }
}

export function isVisionaryHostOperationPendingError(error: unknown): error is VisionaryHostOperationPendingError {
    return error instanceof VisionaryHostOperationPendingError;
}

export function isVisionaryHostPreflightCancelledError(error: unknown): error is VisionaryHostPreflightCancelledError {
    return error instanceof VisionaryHostPreflightCancelledError;
}

export function createVisionaryOperationContext(projectId: string, nodeId: string, kind: "image" | "text" | "quote"): VisionaryHostRequestContext {
    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return {
        clientOperationId: `canvas:${kind}:${id}`,
        projectId,
        nodeId,
    };
}

export async function exchangeVisionaryHostTicket(ticket: string, nonce: string) {
    return hostJson<VisionaryHostExchangeResponse>("/auth/exchange", {
        method: "POST",
        body: JSON.stringify({ ticket, protocolVersion: VISIONARY_HOST_PROTOCOL_VERSION, iframeNonce: nonce }),
    });
}

export async function fetchVisionaryHostBootstrap() {
    return hostJson<VisionaryHostBootstrap>("/bootstrap");
}

export async function quoteVisionaryHostImage(context: VisionaryHostRequestContext, parameters: HostImageParameters, signal?: AbortSignal) {
    // Hosted image pricing only depends on generation parameters. Keeping the
    // prompt out of quote requests avoids resubmitting it while the user types.
    const request = buildImageRequest(context, "", parameters);
    return hostJson<VisionaryHostImageQuote>("/quote", {
        method: "POST",
        body: JSON.stringify(request),
        signal,
    });
}

export async function requestVisionaryHostImage(context: VisionaryHostRequestContext, prompt: string, parameters: HostImageParameters, references: ReferenceImage[], options?: HostOperationRequestOptions) {
    const request = buildImageRequest(context, prompt, parameters);
    const admissionNodeId = options?.hostAdmissionNodeId || context.nodeId;
    const admissionGroupId = options?.hostAdmissionGroupId || context.clientOperationId;
    const body = await withHostNodeAdmissionLock(context, options, async () => {
        // Keep preparation inside the cross-tab node lock. Compression/read
        // failures still happen before a durable operation exists, while a
        // second tab cannot race this preparation into another charge.
        const preparedBody = references.length ? await buildImageFormData(request, references) : JSON.stringify(request);
        throwIfAborted(options?.signal);
        const now = Date.now();
        await persistHostOperationPreflight(
            context,
            () =>
                saveHostOperation({
                    ...context,
                    kind: "image",
                    admissionNodeId,
                    admissionGroupId,
                    status: "preflight",
                    createdAt: now,
                    updatedAt: now,
                }),
            async () => {
                if (!(await updateHostOperation(context.clientOperationId, { status: "submitting", error: undefined }))) {
                    throw new Error("本地图片任务记录已丢失。");
                }
            },
            async (error) => {
                if (!(await updateHostOperation(context.clientOperationId, { status: "failed", error }))) {
                    throw new Error("本地图片任务记录已丢失。");
                }
            },
            options,
        );
        return preparedBody;
    });

    let admitted = false;
    try {
        const response = await hostResponse("/images", {
            method: "POST",
            body,
            signal: options?.signal,
        });
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (!response.ok) throw responseError(response.status, payload, "图片生成失败。");
        admitted = true;

        const normalized = normalizeImageResponse(payload, context.clientOperationId);
        const responseStatus = (normalized.status || "").toLowerCase();
        const terminalError = readString(payload?.error) || readString(payload?.message);
        const actionRequired = Boolean(payload?.actionRequired);
        if (!normalized.images.length && (["failed", "not_found", "rejected"].includes(responseStatus) || actionRequired || terminalError)) {
            const error = terminalError || (actionRequired ? "本次图片任务需要人工处理，已停止生成并退回积分。" : "图片生成失败。");
            await updateHostOperation(context.clientOperationId, {
                status: "failed",
                error,
                billing: normalized.billing,
            });
            publishBilling(normalized.billing);
            throw new VisionaryHostTerminalOperationError(error);
        }
        if (normalized.images.length) {
            await recordCompletedImage(normalized);
            publishBilling(normalized.billing);
            return normalized;
        }

        const generationId = readString(payload?.id);
        await updateHostOperation(context.clientOperationId, {
            status: "pending",
            generationId,
            billing: normalized.billing,
        });
        publishBilling(normalized.billing);
        return await pollVisionaryHostImage(context, responseRetrySeconds(payload), options?.signal);
    } catch (error) {
        if (error instanceof VisionaryHostTerminalOperationError) throw error;
        if (error instanceof VisionaryHostPreDispatchError) {
            if (!(await updateHostOperation(context.clientOperationId, { status: "failed", error: error.message }))) {
                throw new VisionaryHostOperationPendingError(context.clientOperationId, context.nodeId, "本地任务状态仍在确认，请勿重复生成。");
            }
            try {
                await options?.onHostOperationPreflightFailed?.(context);
            } catch {
                throw new VisionaryHostOperationPendingError(context.clientOperationId, context.nodeId, "本地任务正在恢复，请勿重复生成。");
            }
            await acknowledgeHostOperation(context.clientOperationId).catch(() => undefined);
            throw error;
        }
        if (!admitted && error instanceof VisionaryHostApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
            await updateHostOperation(context.clientOperationId, { status: "failed", error: error.message });
            throw error;
        }
        // Abort, network failure, 429 and 5xx are ambiguous after the local
        // operation was saved. Recovery must confirm the original operation
        // ID before the UI is allowed to create another chargeable request.
        throw new VisionaryHostOperationPendingError(context.clientOperationId, context.nodeId, isAbortError(error) ? "已停止本地等待，正在确认服务端任务状态，请勿重复生成。" : undefined);
    }
}

export async function recoverStoredVisionaryHostImages(
    projectId: string,
    onTerminal: (record: VisionaryHostOperationRecord) => Promise<boolean> | boolean,
    signal?: AbortSignal,
    onActive?: (records: VisionaryHostOperationRecord[]) => Promise<void> | void,
    imageDeliveryAckEnabled = false,
) {
    const records = await listHostOperations(projectId);
    throwIfAborted(signal);

    let deliveryFailures = 0;
    const attemptedTerminalIds = new Set<string>();
    const recoveryNow = Date.now();
    for (const record of records.filter((item) => item.status === "preflight" && recoveryNow - item.createdAt >= HOST_OPERATION_PREFLIGHT_GRACE_MS)) {
        const failed = { ...record, status: "failed" as const, error: "图片请求在服务端提交前已中断，未扣除积分。" };
        await updateHostOperation(record.clientOperationId, { status: failed.status, error: failed.error });
        attemptedTerminalIds.add(record.clientOperationId);
        if (!(await finalizeRecoveredVisionaryHostImage(failed, onTerminal, imageDeliveryAckEnabled, signal))) deliveryFailures += 1;
    }
    for (const record of records.filter((item) => item.status === "completed" || item.status === "failed")) {
        attemptedTerminalIds.add(record.clientOperationId);
        if (!(await finalizeRecoveredVisionaryHostImage(record, onTerminal, imageDeliveryAckEnabled, signal))) deliveryFailures += 1;
    }

    const active = records.filter((record) => record.status === "submitting" || record.status === "pending");
    const blockingPreflight = records.filter((record) => record.status === "preflight" && recoveryNow - record.createdAt < HOST_OPERATION_PREFLIGHT_GRACE_MS);
    // Let the canvas restore its node-level duplicate-submit guard before any
    // recovery network wait. This closes the refresh race where IndexedDB had
    // the operation but the debounced project snapshot did not yet contain it.
    await onActive?.([...blockingPreflight, ...active]);
    if (active.length) {
        // Process every active operation, not only the first server-sized
        // batch. Without chunking, a long-running first six operations could
        // starve later generations forever because the server truncates its
        // input to the recovery limit.
        for (let offset = 0; offset < active.length; offset += HOST_IMAGE_RECOVERY_BATCH_LIMIT) {
            const batch = active.slice(offset, offset + HOST_IMAGE_RECOVERY_BATCH_LIMIT);
            const recordById = new Map(batch.map((record) => [record.clientOperationId, record] as const));
            const recovery = await recoverVisionaryHostImageBatch(
                batch.map((record) => record.clientOperationId),
                signal,
            );
            for (const result of recovery.results) {
                const patch = recoveryPatch(result, recordById.get(result.operationId));
                if ((result.status === "completed" || result.status === "success") && result.id) {
                    patch.imageUrl = visionaryHostMediaUrl(result.id);
                }
                if ((result.status === "completed" || result.status === "success") && !result.id) {
                    patch.status = "failed";
                    patch.error = "图片任务已完成，但没有返回生成记录。";
                }
                if (recovery.credits != null) {
                    patch.billing = {
                        state: patch.status === "failed" ? "refunded" : patch.status === "completed" ? "settled" : "reserved",
                        reservedCredits: Math.max(0, Number(result.chargedCredits) || 0),
                        chargedCredits: patch.status === "completed" ? Math.max(0, Number(result.chargedCredits) || 0) : 0,
                        refundedCredits: 0,
                        remainingCredits: recovery.credits,
                    };
                }
                await updateHostOperation(result.operationId, patch);
                if (patch.billing) publishBilling(patch.billing);
            }
        }
    }

    // Deliver terminal records produced by this recovery pass immediately.
    const refreshed = await listHostOperations(projectId);
    for (const record of refreshed.filter((item) => !attemptedTerminalIds.has(item.clientOperationId) && (item.status === "completed" || item.status === "failed"))) {
        if (!(await finalizeRecoveredVisionaryHostImage(record, onTerminal, imageDeliveryAckEnabled, signal))) deliveryFailures += 1;
    }
    return {
        activeCount: refreshed.filter((record) => record.status === "preflight" || record.status === "submitting" || record.status === "pending").length,
        deliveryFailures,
    };
}

async function finalizeRecoveredVisionaryHostImage(
    record: VisionaryHostOperationRecord,
    onTerminal: (record: VisionaryHostOperationRecord) => Promise<boolean> | boolean,
    imageDeliveryAckEnabled: boolean,
    signal?: AbortSignal,
) {
    let locallyDelivered = Boolean(record.localDeliveryCompletedAt);
    if (!locallyDelivered) {
        if (!(await onTerminal(record))) return false;
        if (record.status === "completed" && imageDeliveryAckEnabled) {
            const localDeliveryCompletedAt = Date.now();
            if (!(await updateHostOperation(record.clientOperationId, { localDeliveryCompletedAt }))) return false;
            record = { ...record, localDeliveryCompletedAt };
            locallyDelivered = true;
        }
    }
    if (record.status === "completed" && imageDeliveryAckEnabled) {
        if (!record.generationId) return false;
        try {
            const request: VisionaryHostImageDeliveryAckRequest = {
                clientOperationId: record.clientOperationId,
                generationId: record.generationId,
                clientReleaseVersion: VISIONARY_RELEASE_VERSION,
            };
            await withHostDeliveryAckTimeout(signal, (ackSignal) =>
                hostJson<VisionaryHostImageDeliveryAckResponse>("/images/delivery-ack", {
                    method: "POST",
                    body: JSON.stringify(request),
                    signal: ackSignal,
                }),
            );
        } catch (error) {
            if (signal?.aborted && isAbortError(error)) throw error;
            return false;
        }
    }
    await acknowledgeHostOperation(record.clientOperationId);
    return true;
}

async function withHostDeliveryAckTimeout<T>(
    parentSignal: AbortSignal | undefined,
    run: (signal: AbortSignal) => Promise<T>,
) {
    throwIfAborted(parentSignal);
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    const timeout = setTimeout(() => controller.abort(), HOST_IMAGE_DELIVERY_ACK_TIMEOUT_MS);
    try {
        return await run(controller.signal);
    } finally {
        clearTimeout(timeout);
        parentSignal?.removeEventListener("abort", abortFromParent);
    }
}

export async function requestVisionaryHostText(context: VisionaryHostRequestContext, content: string, model: string, onDelta: (text: string) => void, options?: HostOperationRequestOptions) {
    const modelKey = normalizeHostedModel(model);
    if (!content.trim()) throw new Error("请输入文本生成要求。");
    const admissionNodeId = options?.hostAdmissionNodeId || context.nodeId;
    const admissionGroupId = options?.hostAdmissionGroupId || context.clientOperationId;
    const { conversation } = await withHostNodeAdmissionLock(context, options, async () => {
        let selectedModel: string;
        let conversation: StoredTextConversation;
        try {
            const capabilities = await fetchVisionaryHostTextCapabilities(options?.signal);
            if (!capabilities.enabled) throw new Error("AI 文本功能当前不可用。");
            selectedModel = capabilities.models.some((item) => item.key === modelKey) ? modelKey : capabilities.defaultModel;
            conversation = await getOrCreateTextConversation(context, selectedModel, options?.signal);
            throwIfAborted(options?.signal);
        } catch (error) {
            // Capabilities/conversation setup does not create a billable text
            // run and no durable operation exists yet.
            if (isAbortError(error)) {
                throw new VisionaryHostPreflightCancelledError(context.clientOperationId, context.nodeId);
            }
            throw error;
        }
        const now = Date.now();
        await persistHostOperationPreflight(
            context,
            () =>
                saveHostTextOperation({
                    ...context,
                    kind: "text",
                    admissionNodeId,
                    admissionGroupId,
                    status: "preflight",
                    content,
                    model: selectedModel,
                    conversationId: conversation!.conversationId,
                    createdAt: now,
                    updatedAt: now,
                }),
            async () => {
                if (!(await updateHostTextOperation(context.clientOperationId, { status: "submitting", error: undefined }))) {
                    throw new Error("本地文本任务记录已丢失。");
                }
            },
            async (error) => {
                if (!(await updateHostTextOperation(context.clientOperationId, { status: "failed", error }))) {
                    throw new Error("本地文本任务记录已丢失。");
                }
            },
            options,
        );
        return { conversation };
    });
    try {
        const run = await createTextRunSafely(conversation.conversationId, context, content, options?.signal);
        await updateHostTextOperation(context.clientOperationId, { status: "pending", runId: run.runId });
        if (run.reservation?.remainingCredits != null) {
            publishBilling({
                state: "reserved",
                reservedCredits: Math.max(0, Number(run.reservation.reservedCredits) || 0),
                chargedCredits: 0,
                refundedCredits: 0,
                remainingCredits: Number(run.reservation.remainingCredits),
            });
        }
        try {
            const output = await streamVisionaryHostTextRun(run.runId, onDelta, options?.signal);
            await updateHostTextOperation(context.clientOperationId, { status: "completed", output, error: undefined });
            return output;
        } catch (error) {
            if (error instanceof VisionaryHostTerminalOperationError) throw error;
            if (isAbortError(error)) {
                try {
                    const cancellationStatus = await cancelVisionaryHostTextRun(run.runId);
                    if (cancellationStatus === "cancelled") {
                        await refreshVisionaryHostCredits("refunded").catch(() => undefined);
                        const cancelled = new VisionaryHostTerminalOperationError("文本任务已取消，积分已退回。");
                        await updateHostTextOperation(context.clientOperationId, { status: "failed", error: cancelled.message });
                        throw cancelled;
                    }
                } catch (cancelError) {
                    if (cancelError instanceof VisionaryHostTerminalOperationError) throw cancelError;
                    // A failed/409 cancellation remains ambiguous. Recovery
                    // reconnects to the exact run before enabling a new charge.
                }
                if (options?.signal?.aborted) {
                    throw new VisionaryHostOperationPendingError(context.clientOperationId, context.nodeId, "已停止本地等待，服务端文本任务正在取消或确认，请勿重复生成。");
                }
            }
            throw new VisionaryHostOperationPendingError(context.clientOperationId, context.nodeId, isAbortError(error) ? "已停止本地等待，服务端文本任务状态仍在确认，请勿重复生成。" : "文本生成连接中断，服务端任务状态仍在确认，请勿重复生成。");
        }
    } catch (error) {
        if (error instanceof VisionaryHostTerminalOperationError) {
            await updateHostTextOperation(context.clientOperationId, { status: "failed", error: error.message });
            throw error;
        }
        if (isVisionaryHostOperationPendingError(error)) throw error;
        if (error instanceof VisionaryHostPreDispatchError) {
            if (!(await updateHostTextOperation(context.clientOperationId, { status: "failed", error: error.message }))) {
                throw new VisionaryHostOperationPendingError(context.clientOperationId, context.nodeId, "本地文本任务状态仍在确认，请勿重复生成。");
            }
            try {
                await options?.onHostOperationPreflightFailed?.(context);
            } catch {
                throw new VisionaryHostOperationPendingError(context.clientOperationId, context.nodeId, "本地文本任务正在恢复，请勿重复生成。");
            }
            await acknowledgeHostOperation(context.clientOperationId).catch(() => undefined);
            throw error;
        }
        if (error instanceof VisionaryHostApiError && error.status >= 400 && error.status < 500) {
            await updateHostTextOperation(context.clientOperationId, { status: "failed", error: error.message });
            throw error;
        }
        throw new VisionaryHostOperationPendingError(context.clientOperationId, context.nodeId, "文本任务响应中断，正在确认服务端状态，请勿重复生成。");
    }
}

export async function cancelVisionaryHostTextRun(runId: string) {
    const response = await hostResponse(`/text/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) throw responseError(response.status, payload, "停止文本生成失败。");
    const data = isRecord(payload?.data) ? payload.data : payload;
    return readString(data?.status) || "cancelling";
}

export async function recoverStoredVisionaryHostTexts(
    projectId: string,
    onTerminal: (record: VisionaryHostTextOperationRecord) => Promise<boolean> | boolean,
    onDelta: (record: VisionaryHostTextOperationRecord, text: string) => void,
    signal?: AbortSignal,
    shouldRecover: (record: VisionaryHostTextOperationRecord) => boolean = () => true,
    onActive?: (records: VisionaryHostTextOperationRecord[]) => Promise<void> | void,
) {
    const records = await listHostTextOperations(projectId);
    throwIfAborted(signal);

    let deliveryFailures = 0;
    const attemptedTerminalIds = new Set<string>();
    const recoveryNow = Date.now();
    for (const record of records.filter((item) => item.status === "preflight" && recoveryNow - item.createdAt >= HOST_OPERATION_PREFLIGHT_GRACE_MS)) {
        const failed = { ...record, status: "failed" as const, error: "文本请求在服务端提交前已中断，未扣除积分。" };
        await updateHostTextOperation(record.clientOperationId, { status: failed.status, error: failed.error });
        attemptedTerminalIds.add(record.clientOperationId);
        if (await onTerminal(failed)) await acknowledgeHostOperation(record.clientOperationId);
        else deliveryFailures += 1;
    }
    for (const record of records.filter((item) => item.status === "completed" || item.status === "failed")) {
        attemptedTerminalIds.add(record.clientOperationId);
        if (await onTerminal(record)) await acknowledgeHostOperation(record.clientOperationId);
        else deliveryFailures += 1;
    }

    const active = records.filter((item) => item.status === "submitting" || item.status === "pending");
    const blockingPreflight = records.filter((item) => item.status === "preflight" && recoveryNow - item.createdAt < HOST_OPERATION_PREFLIGHT_GRACE_MS);
    await onActive?.([...blockingPreflight, ...active]);
    for (const record of active.filter(shouldRecover)) {
        throwIfAborted(signal);
        let admitted = Boolean(record.runId);
        try {
            let runId = record.runId;
            if (!runId) {
                const run = await createTextRunSafely(record.conversationId, record, record.content, signal);
                runId = run.runId;
                admitted = true;
                await updateHostTextOperation(record.clientOperationId, { status: "pending", runId });
            }
            const output = await streamVisionaryHostTextRun(runId, (text) => onDelta(record, text), signal);
            await updateHostTextOperation(record.clientOperationId, { status: "completed", runId, output, error: undefined });
        } catch (error) {
            if (isAbortError(error)) throw error;
            if (error instanceof VisionaryHostTerminalOperationError) {
                await updateHostTextOperation(record.clientOperationId, { status: "failed", error: error.message });
            } else if (error instanceof VisionaryHostApiError && shouldMarkTextRecoveryClientFailure(admitted, error.status)) {
                await updateHostTextOperation(record.clientOperationId, { status: "failed", error: error.message });
            }
            // Once the server returned a run ID, even a later 4xx can be a
            // transient session/permission response while that run continues.
            // Keep it pending and reconnect to the exact run after renewal.
            // Before admission, replaying the same idempotency key is safe.
        }
    }

    const refreshed = await listHostTextOperations(projectId);
    for (const record of refreshed.filter((item) => !attemptedTerminalIds.has(item.clientOperationId) && (item.status === "completed" || item.status === "failed"))) {
        if (await onTerminal(record)) await acknowledgeHostOperation(record.clientOperationId);
        else deliveryFailures += 1;
    }
    return {
        activeCount: refreshed.filter((record) => record.status === "preflight" || record.status === "submitting" || record.status === "pending").length,
        deliveryFailures,
    };
}

async function pollVisionaryHostImage(context: VisionaryHostRequestContext, initialRetrySeconds: number, signal?: AbortSignal): Promise<VisionaryHostImageResponse> {
    const operationId = context.clientOperationId;
    let retrySeconds = Math.max(1, initialRetrySeconds || 2);
    while (true) {
        await abortableDelay(retrySeconds * 1000, signal);
        const recovery = await recoverVisionaryHostImageBatch([operationId], signal);
        const result = recovery.results.find((item) => item.operationId === operationId);
        if (!result || result.status === "pending") {
            retrySeconds = Math.max(1, result?.retryAfterSeconds || recovery.retryAfterSeconds || 2);
            continue;
        }
        if (result.status === "failed" || result.status === "not_found") {
            const records = await listHostOperations(context.projectId);
            const record = records.find((item) => item.clientOperationId === operationId);
            const patch = recoveryPatch(result, record);
            await updateHostOperation(operationId, patch);
            if (patch.status !== "failed") {
                retrySeconds = Math.max(1, result.retryAfterSeconds || recovery.retryAfterSeconds || 2);
                continue;
            }
            throw new VisionaryHostTerminalOperationError(patch.error || "图片生成失败。");
        }
        if (!result.id) throw new Error("图片任务已完成，但没有返回生成记录。");
        const url = visionaryHostMediaUrl(result.id);
        const billing = recoveryBilling(result.chargedCredits, recovery.credits);
        const normalized: VisionaryHostImageResponse = {
            operationId,
            status: result.status,
            images: [{ generationId: result.id || operationId, url }],
            billing,
        };
        await recordCompletedImage(normalized);
        publishBilling(billing);
        return normalized;
    }
}

async function recoverVisionaryHostImageBatch(operationIds: string[], signal?: AbortSignal) {
    return hostJson<VisionaryHostImageRecoveryResponse>("/images/recover-batch", {
        method: "POST",
        body: JSON.stringify({ operationIds }),
        signal,
    });
}

async function recordCompletedImage(response: VisionaryHostImageResponse) {
    const image = response.images[0];
    await updateHostOperation(response.operationId, {
        status: "completed",
        generationId: image?.generationId,
        imageUrl: image?.url,
        billing: response.billing,
        error: undefined,
    });
}

function buildImageRequest(context: VisionaryHostRequestContext, prompt: string, parameters: HostImageParameters): VisionaryHostImageRequest {
    return {
        ...context,
        ...(VISIONARY_RELEASE_VERSION ? { clientReleaseVersion: VISIONARY_RELEASE_VERSION } : {}),
        prompt,
        model: normalizeHostedModel(parameters.model),
        ratio: normalizeRatio(parameters.ratio),
        imageSize: normalizeImageSize(parameters.imageSize),
        quality: normalizeQuality(parameters.quality),
        optimizeChineseText: Boolean(parameters.optimizeChineseText),
    };
}

async function buildImageFormData(request: VisionaryHostImageRequest, references: ReferenceImage[]) {
    if (references.length > MAX_HOST_REFERENCE_IMAGES) throw new Error(`最多只能上传 ${MAX_HOST_REFERENCE_IMAGES} 张参考图。`);
    const form = new FormData();
    Object.entries(request).forEach(([key, value]) => {
        if (Array.isArray(value)) form.set(key, JSON.stringify(value));
        else form.set(key, String(value));
    });
    // Decode/compress one reference at a time. This keeps several large
    // canvas images from allocating full-size canvases concurrently. The
    // per-image target also keeps the whole request under the server's 30MB
    // aggregate reference limit.
    const targetBytes = Math.min(6 * 1024 * 1024, Math.floor(MAX_HOST_REFERENCE_TOTAL_BYTES / Math.max(1, references.length)));
    const blobs: Blob[] = [];
    for (const reference of references) {
        blobs.push(await referenceImageBlob(reference, targetBytes));
    }
    blobs.forEach((blob, index) => form.append("images", blob, `reference-${index + 1}.${imageExtension(blob.type)}`));
    return form;
}

async function referenceImageBlob(image: ReferenceImage, targetBytes: number) {
    const cachedByTarget = preparedReferenceBlobs.get(image);
    const cached = cachedByTarget?.get(targetBytes);
    if (cached) return cached;

    const pending = (async () => {
        const stored = image.storageKey ? await getImageBlob(image.storageKey) : null;
        if (stored) return prepareReferenceImageForUpload(assertImageBlob(stored), targetBytes);
        const source = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
        if (!source) throw new Error("参考图片已丢失，无法提交生成。");
        let blob: Blob;
        try {
            blob = assertImageBlob(source.startsWith("data:") ? dataUrlToBlob(source) : await (await fetch(source)).blob());
        } catch {
            throw new Error("参考图片读取失败，请重新上传后再试。");
        }
        return prepareReferenceImageForUpload(blob, targetBytes);
    })();
    const nextCache = cachedByTarget || new Map<number, Promise<Blob>>();
    nextCache.set(targetBytes, pending);
    preparedReferenceBlobs.set(image, nextCache);
    try {
        return await pending;
    } catch (error) {
        nextCache.delete(targetBytes);
        throw error;
    }
}

function assertImageBlob(blob: Blob) {
    if (!blob.type.startsWith("image/")) throw new Error("参考文件不是有效图片。");
    return blob;
}

function dataUrlToBlob(dataUrl: string) {
    const separator = dataUrl.indexOf(",");
    if (separator < 0) throw new Error("参考图片数据格式无效。");
    const header = dataUrl.slice(0, separator);
    const body = dataUrl.slice(separator + 1);
    const type = header.match(/^data:([^;,]+)/i)?.[1] || "application/octet-stream";
    if (/;base64/i.test(header)) {
        const binary = atob(body);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        return new Blob([bytes], { type });
    }
    return new Blob([decodeURIComponent(body)], { type });
}

function imageExtension(mimeType: string) {
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    return "png";
}

let textCapabilities: VisionaryHostTextCapabilities | null = null;

async function fetchVisionaryHostTextCapabilities(signal?: AbortSignal) {
    if (textCapabilities) return textCapabilities;
    textCapabilities = await hostJson<VisionaryHostTextCapabilities>("/text/capabilities", { signal });
    return textCapabilities;
}

async function getOrCreateTextConversation(context: VisionaryHostRequestContext, modelKey: string, signal?: AbortSignal) {
    const key = visionaryHostStorageKey(`${context.projectId}:${context.nodeId}`);
    const stored = await textConversationStore.getItem<StoredTextConversation>(key);
    if (stored?.conversationId && stored.modelKey === modelKey) return stored;
    const payload = await hostJson<{ data?: VisionaryHostTextConversation } | VisionaryHostTextConversation>("/text/conversations", {
        method: "POST",
        body: JSON.stringify({ modelKey, title: `画布节点 ${context.nodeId}` }),
        signal,
    });
    const conversation = "data" in payload && payload.data ? payload.data : (payload as VisionaryHostTextConversation);
    if (!conversation.id) throw new Error("文本会话创建失败。");
    const next = { conversationId: conversation.id, modelKey };
    await textConversationStore.setItem(key, next);
    return next;
}

async function createTextRun(conversationId: string, idempotencyKey: string, content: string, signal?: AbortSignal) {
    const response = await hostResponse(`/text/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ content }),
        signal,
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok && response.status !== 409) throw responseError(response.status, payload, "文本任务创建失败。");
    const data = isRecord(payload?.data) ? payload.data : payload;
    const runId = readString(data?.runId);
    if (!runId) throw responseError(response.status, payload, "文本任务创建失败。");
    return {
        runId,
        reservation: isRecord(data?.reservation) ? data.reservation : null,
    } as VisionaryHostTextRun;
}

async function createTextRunSafely(conversationId: string, context: VisionaryHostRequestContext, content: string, signal?: AbortSignal) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await createTextRun(conversationId, context.clientOperationId, content, signal);
        } catch (error) {
            // A received 4xx is an explicit rejection before ChatRun
            // creation. Only transport/5xx ambiguity is replayed with the
            // same idempotency key.
            if (error instanceof VisionaryHostPreDispatchError) throw error;
            if (error instanceof VisionaryHostApiError && error.status >= 400 && error.status < 500) throw error;
            if (isAbortError(error) || attempt === 2) {
                throw new VisionaryHostOperationPendingError(context.clientOperationId, context.nodeId, isAbortError(error) ? "已停止本地等待，服务端文本任务状态仍在确认，请勿重复生成。" : "文本任务响应中断，正在确认服务端状态，请勿重复生成。");
            }
            try {
                await abortableDelay(500 * 2 ** attempt, signal);
            } catch (delayError) {
                if (isAbortError(delayError)) {
                    throw new VisionaryHostOperationPendingError(context.clientOperationId, context.nodeId, "已停止本地等待，服务端文本任务状态仍在确认，请勿重复生成。");
                }
                throw delayError;
            }
        }
    }
    throw new VisionaryHostOperationPendingError(context.clientOperationId, context.nodeId);
}

async function streamVisionaryHostTextRun(runId: string, onDelta: (text: string) => void, signal?: AbortSignal) {
    let output = "";
    let lastEventId = "";
    let terminal = false;
    let terminalError = "";
    let terminalBillingState: "settled" | "refunded" | null = null;
    let needsCreditRefresh = false;
    let reconnects = 0;
    while (!terminal) {
        throwIfAborted(signal);
        const response = await hostResponse(`/text/runs/${encodeURIComponent(runId)}/events`, {
            headers: lastEventId ? { "Last-Event-ID": lastEventId } : undefined,
            signal,
        });
        if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
            throw responseError(response.status, payload, "连接文本生成流失败。");
        }
        await readSse(response, (frame) => {
            if (frame.id) lastEventId = frame.id;
            if (frame.event === "message.delta" && typeof frame.data.delta === "string") {
                output += frame.data.delta;
                onDelta(output);
            }
            if (frame.event === "run.snapshot") {
                if (isRecord(frame.data.message) && typeof frame.data.message.content === "string") {
                    output = frame.data.message.content;
                    onDelta(output);
                }
                const snapshotStatus = readString(frame.data.status).toLowerCase();
                if (snapshotStatus === "completed") {
                    terminal = true;
                    terminalBillingState = "settled";
                    needsCreditRefresh = true;
                } else if (snapshotStatus === "cancelled" || snapshotStatus === "failed") {
                    terminal = true;
                    terminalBillingState = "refunded";
                    needsCreditRefresh = true;
                    terminalError = snapshotStatus === "cancelled" ? "文本任务已取消，积分已退回。" : "文本生成失败。";
                }
            }
            if (frame.event === "run.completed") {
                terminal = true;
                terminalBillingState = "settled";
                const chargedCredits = Math.max(0, Number(frame.data.chargedCredits) || 0);
                const remainingCredits = Number(frame.data.remainingCredits);
                if (Number.isFinite(remainingCredits)) {
                    publishBilling({
                        state: "settled",
                        reservedCredits: chargedCredits,
                        chargedCredits,
                        refundedCredits: 0,
                        remainingCredits,
                    });
                } else needsCreditRefresh = true;
            }
            if (frame.event === "run.cancelled" || frame.event === "run.error") {
                terminal = true;
                terminalBillingState = "refunded";
                terminalError = frame.event === "run.cancelled" ? "文本任务已取消，积分已退回。" : typeof frame.data.error === "string" ? frame.data.error : "文本生成失败。";
                const remainingCredits = Number(frame.data.remainingCredits);
                if (Number.isFinite(remainingCredits)) {
                    publishBilling({
                        state: "refunded",
                        reservedCredits: 0,
                        chargedCredits: 0,
                        refundedCredits: 0,
                        remainingCredits,
                    });
                } else needsCreditRefresh = true;
            }
            if (frame.event === "done") terminal = true;
        });
        if (!terminal) {
            reconnects += 1;
            if (reconnects > 5) throw new Error("文本生成连接已中断，请稍后重试。");
            await abortableDelay(Math.min(1000 * 2 ** reconnects, 5000), signal);
        }
    }
    if (needsCreditRefresh && terminalBillingState) await refreshVisionaryHostCredits(terminalBillingState).catch(() => undefined);
    if (terminalError) throw new VisionaryHostTerminalOperationError(terminalError);
    if (!output.trim()) throw new VisionaryHostTerminalOperationError("文本模型没有返回内容。");
    return output;
}

async function readSse(response: Response, onFrame: (frame: VisionaryHostSseFrame) => void) {
    if (!response.body) throw new Error("文本服务没有返回流式内容。");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const parsed = parseSseFrames(pending);
        pending = parsed.remainder;
        parsed.frames.forEach(onFrame);
    }
    pending += decoder.decode();
    parseSseFrames(`${pending}\n\n`).frames.forEach(onFrame);
}

function parseSseFrames(buffer: string) {
    const frames: VisionaryHostSseFrame[] = [];
    const records = buffer.split(/\r?\n\r?\n/);
    const remainder = records.pop() || "";
    for (const record of records) {
        let id = "";
        let event = "message";
        let rawData = "";
        for (const line of record.split(/\r?\n/)) {
            if (line.startsWith("id:")) id = line.slice(3).trim();
            if (line.startsWith("event:")) event = line.slice(6).trim();
            if (line.startsWith("data:")) rawData += line.slice(5).trim();
        }
        if (!rawData) continue;
        try {
            const data = JSON.parse(rawData) as Record<string, unknown>;
            frames.push({ ...(id ? { id } : {}), event, data });
        } catch {
            // Ignore a malformed frame; later valid frames can still finish the run.
        }
    }
    return { frames, remainder };
}

function normalizeImageResponse(payload: Record<string, unknown> | null, fallbackOperationId: string): VisionaryHostImageResponse {
    const operationId = readString(payload?.operationId) || fallbackOperationId;
    const rawImages = Array.isArray(payload?.images) ? payload.images : [];
    const images = rawImages
        .map((item) => {
            if (!isRecord(item)) return null;
            const generationId = readString(item.generationId) || readString(item.id);
            if (!generationId) return null;
            return { generationId, url: visionaryHostMediaUrl(generationId) };
        })
        .filter((item): item is { generationId: string; url: string } => Boolean(item));
    const generationId = readString(payload?.id);
    const status = readString(payload?.status).toLowerCase();
    if (!images.length && generationId && ["completed", "success", "succeeded", "fallback_review"].includes(status)) {
        images.push({ generationId, url: visionaryHostMediaUrl(generationId) });
    }

    const rawBilling = isRecord(payload?.billing) ? payload.billing : null;
    const chargedCredits = Math.max(0, Number(rawBilling?.chargedCredits ?? payload?.chargedCredits) || 0);
    const remainingCredits = Number(rawBilling?.remainingCredits ?? (isRecord(payload?.user) ? payload.user.credits : undefined));
    return {
        operationId,
        status: readString(payload?.status),
        retryAfterSeconds: responseRetrySeconds(payload),
        images,
        billing: {
            state: normalizeBillingState(rawBilling?.state, images.length ? "settled" : "reserved"),
            reservedCredits: Math.max(0, Number(rawBilling?.reservedCredits) || chargedCredits),
            chargedCredits,
            refundedCredits: Math.max(0, Number(rawBilling?.refundedCredits) || 0),
            ...(Number.isFinite(remainingCredits) ? { remainingCredits } : {}),
        },
    };
}

function recoveryBilling(chargedCredits: number | undefined, credits: number | undefined): VisionaryHostBilling {
    return {
        state: "settled",
        reservedCredits: Math.max(0, Number(chargedCredits) || 0),
        chargedCredits: Math.max(0, Number(chargedCredits) || 0),
        refundedCredits: 0,
        ...(Number.isFinite(Number(credits)) ? { remainingCredits: Number(credits) } : {}),
    };
}

function publishBilling(billing: VisionaryHostBilling) {
    window.dispatchEvent(new CustomEvent(VISIONARY_HOST_BILLING_EVENT, { detail: billing }));
}

async function refreshVisionaryHostCredits(state: "settled" | "refunded") {
    const bootstrap = await fetchVisionaryHostBootstrap();
    publishBilling({
        state,
        reservedCredits: 0,
        chargedCredits: 0,
        refundedCredits: 0,
        remainingCredits: bootstrap.user.credits,
    });
}

async function hostJson<T>(path: string, init: RequestInit = {}) {
    const response = await hostResponse(path, init);
    const payload = (await response.json().catch(() => null)) as T | Record<string, unknown> | null;
    if (!response.ok) throw responseError(response.status, isRecord(payload) ? payload : null, "画布服务请求失败。");
    return payload as T;
}

async function hostResponse(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    const method = (init.method || "GET").toUpperCase();
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    headers.set("Accept", headers.get("Accept") || "application/json");
    if (path !== "/auth/exchange" && method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        const csrfToken = readCookie(HOST_CSRF_COOKIE);
        if (!csrfToken) throw new VisionaryHostPreDispatchError("画布安全令牌缺失，请返回主站重新打开画布。");
        headers.set("X-Canvas-CSRF-Token", csrfToken);
    }
    const response = await fetch(`${HOST_API_ROOT}${path}`, {
        ...init,
        headers,
        credentials: "include",
        cache: "no-store",
    });
    if (response.status === 401) {
        window.dispatchEvent(new CustomEvent(VISIONARY_HOST_SESSION_INVALID_EVENT, { detail: "画布会话已失效，请刷新登录票据。" }));
    }
    return response;
}

function assertHostMutationReady() {
    if (!readCookie(HOST_CSRF_COOKIE)) {
        throw new VisionaryHostPreDispatchError("画布安全令牌缺失，请返回主站重新打开画布。");
    }
}

function visionaryHostMediaUrl(generationId: string) {
    return `${HOST_API_ROOT}/images/${encodeURIComponent(generationId)}/media`;
}

function readCookie(name: string) {
    const prefix = `${encodeURIComponent(name)}=`;
    const entry = document.cookie
        .split(";")
        .map((item) => item.trim())
        .find((item) => item.startsWith(prefix));
    return entry ? decodeURIComponent(entry.slice(prefix.length)) : "";
}

function responseError(status: number, payload: Record<string, unknown> | null, fallback: string) {
    const raw = readString(payload?.error) || readString(payload?.message) || fallback;
    if (status === 401) return new VisionaryHostApiError(status, "画布会话已失效，请返回主站重新打开画布。");
    if (status === 403) return new VisionaryHostApiError(status, raw || "当前账号没有画布使用权限。");
    if (status === 404) return new VisionaryHostApiError(status, raw || "画布功能暂未开放。");
    if (status === 429) return new VisionaryHostApiError(status, raw || "请求过于频繁，请稍后再试。");
    return new VisionaryHostApiError(status, raw);
}

function normalizeRatio(value?: string) {
    const ratio = (value || "").trim();
    if (!ratio) return "1:1";
    if (ratio.toLowerCase() === "auto") return "auto";
    if (/^\d+:\d+$/.test(ratio)) return ratio;
    const dimensions = ratio.match(/^(\d+)x(\d+)$/i);
    if (!dimensions) return "1:1";
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    const divisor = greatestCommonDivisor(width, height);
    return `${width / divisor}:${height / divisor}`;
}

function normalizeImageSize(value?: string) {
    const size = (value || "1K").trim().toUpperCase();
    if (size === "STANDARD") return "1K";
    return size === "2K" || size === "4K" ? size : "1K";
}

function normalizeQuality(value?: string) {
    const quality = (value || "auto").trim().toLowerCase();
    return quality === "low" || quality === "medium" || quality === "high" ? quality : "auto";
}

function greatestCommonDivisor(a: number, b: number): number {
    return b ? greatestCommonDivisor(b, a % b) : Math.max(1, a);
}

function responseRetrySeconds(payload: Record<string, unknown> | null) {
    return Math.max(1, Number(payload?.retryAfterSeconds) || 2);
}

function normalizeBillingState(value: unknown, fallback: VisionaryHostBilling["state"]): VisionaryHostBilling["state"] {
    return value === "reserved" || value === "settled" || value === "refunded" || value === "failed" ? value : fallback;
}

function readString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

async function withHostNodeAdmissionLock<T>(context: VisionaryHostRequestContext, options: HostOperationRequestOptions | undefined, callback: () => Promise<T>): Promise<T> {
    const signal = options?.signal;
    const admissionNodeId = options?.hostAdmissionNodeId || context.nodeId;
    const admissionGroupId = options?.hostAdmissionGroupId || context.clientOperationId;
    const run = async () => {
        throwIfAborted(signal);
        const [imageOperations, textOperations] = await Promise.all([listHostOperations(context.projectId), listHostTextOperations(context.projectId)]);
        const blocking = [...imageOperations, ...textOperations]
            .filter((record) => isHostAdmissionBlocking(record, admissionNodeId, admissionGroupId))
            .sort((left, right) => right.createdAt - left.createdAt)[0];
        if (blocking) {
            throw new VisionaryHostAdmissionBlockedError(blocking.clientOperationId, blocking.nodeId, context.nodeId);
        }
        return callback();
    };

    if (typeof navigator === "undefined" || !navigator.locks) {
        throw new Error("浏览器不支持安全画布锁，请使用新版 Chrome、Edge 或 Safari。");
    }
    const lockName = `visionary-canvas-operation:${context.projectId}:${admissionNodeId}`;
    try {
        return await navigator.locks.request(lockName, { mode: "exclusive", signal }, run);
    } catch (error) {
        if (isAbortError(error)) {
            throw new VisionaryHostPreflightCancelledError(context.clientOperationId, context.nodeId);
        }
        throw error;
    }
}

async function persistHostOperationPreflight(context: VisionaryHostRequestContext, saveOperation: () => Promise<void>, markOperationReady: () => Promise<void>, failOperation: (error: string) => Promise<void>, options?: HostOperationRequestOptions) {
    let operationSaved = false;
    let admissionTransitionStarted = false;
    try {
        // A recovery target and its connections must exist durably before the
        // operation record can outlive this page. The duplicate-submit marker
        // is then flushed after the operation itself and before admission.
        throwIfAborted(options?.signal);
        assertHostMutationReady();
        await options?.onHostOperationTargetReady?.(context);
        throwIfAborted(options?.signal);
        await saveOperation();
        operationSaved = true;
        if (options?.signal?.aborted) {
            throw new VisionaryHostPreflightCancelledError(context.clientOperationId, context.nodeId);
        }
        await options?.onHostOperationDurable?.(context);
        if (options?.signal?.aborted) {
            throw new VisionaryHostPreflightCancelledError(context.clientOperationId, context.nodeId);
        }
        // Only this transition authorizes another tab's recovery loop to
        // perform an idempotent admission. The recovery target and confirming
        // marker are durable before the status becomes "submitting".
        admissionTransitionStarted = true;
        await markOperationReady();
    } catch (error) {
        if (admissionTransitionStarted) {
            throw new VisionaryHostOperationPendingError(context.clientOperationId, context.nodeId, "任务已准备提交，正在确认服务端状态，请勿重复生成。");
        }
        if (operationSaved) {
            const terminalError = error instanceof VisionaryHostPreflightCancelledError || isAbortError(error) ? "请求在服务端提交前已取消，未扣除积分。" : "请求在服务端提交前失败，未扣除积分。";
            try {
                // Mark terminal first. If marker cleanup cannot be persisted,
                // recovery can safely deliver this failed local preflight
                // without ever replaying a text/image admission.
                await failOperation(terminalError);
            } catch {
                throw new VisionaryHostOperationPendingError(context.clientOperationId, context.nodeId, "本地任务状态仍在确认，请勿重复生成。");
            }
        }
        try {
            await options?.onHostOperationPreflightFailed?.(context);
        } catch {
            if (operationSaved) {
                throw new VisionaryHostOperationPendingError(context.clientOperationId, context.nodeId, "本地任务正在恢复，请勿重复生成。");
            }
        }
        if (operationSaved) {
            // The project snapshot no longer carries a confirming marker, so
            // deleting the terminal record cannot strand a permanently locked
            // node. A failed delete is harmless: terminal recovery is idempotent.
            await acknowledgeHostOperation(context.clientOperationId).catch(() => undefined);
        }
        if (error instanceof VisionaryHostPreflightCancelledError) throw error;
        if (isAbortError(error)) {
            throw new VisionaryHostPreflightCancelledError(context.clientOperationId, context.nodeId);
        }
        throw error;
    }
}

function isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === "AbortError";
}

function abortableDelay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        throwIfAborted(signal);
        const timer = window.setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
        }, ms);
        const abort = () => {
            window.clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            reject(new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
    });
}
