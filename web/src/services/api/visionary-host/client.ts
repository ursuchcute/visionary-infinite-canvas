import localforage from "localforage";

import { getImageBlob, resolveImageUrl } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";
import { VISIONARY_HOST_BILLING_EVENT, VISIONARY_HOST_SESSION_INVALID_EVENT, normalizeHostedModel } from "@/constant/visionary-hosted";

import { acknowledgeHostOperation, listHostOperations, recoveryPatch, saveHostOperation, updateHostOperation, type VisionaryHostOperationRecord } from "./operations";
import { visionaryHostStorageKey } from "./storage-namespace";
import type {
    VisionaryHostBilling,
    VisionaryHostBootstrap,
    VisionaryHostExchangeResponse,
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

export class VisionaryHostApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "VisionaryHostApiError";
    }
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
        body: JSON.stringify({ ticket, protocolVersion: 1, iframeNonce: nonce }),
    });
}

export async function fetchVisionaryHostBootstrap() {
    return hostJson<VisionaryHostBootstrap>("/bootstrap");
}

export async function quoteVisionaryHostImage(context: VisionaryHostRequestContext, prompt: string, parameters: HostImageParameters, signal?: AbortSignal) {
    const request = buildImageRequest(context, prompt, parameters);
    return hostJson<VisionaryHostImageQuote>("/quote", {
        method: "POST",
        body: JSON.stringify(request),
        signal,
    });
}

export async function requestVisionaryHostImage(context: VisionaryHostRequestContext, prompt: string, parameters: HostImageParameters, references: ReferenceImage[], options?: { signal?: AbortSignal }) {
    const request = buildImageRequest(context, prompt, parameters);
    const now = Date.now();
    await saveHostOperation({
        ...context,
        kind: "image",
        status: "submitting",
        createdAt: now,
        updatedAt: now,
    });

    try {
        const body = references.length ? await buildImageFormData(request, references) : JSON.stringify(request);
        const response = await hostResponse("/images", {
            method: "POST",
            body,
            signal: options?.signal,
        });
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (!response.ok) throw responseError(response.status, payload, "图片生成失败。");

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
            throw new Error(error);
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
        return await pollVisionaryHostImage(context.clientOperationId, responseRetrySeconds(payload), options?.signal);
    } catch (error) {
        if (isAbortError(error)) throw error;
        if (error instanceof VisionaryHostApiError && error.status >= 400 && error.status < 500) {
            await updateHostOperation(context.clientOperationId, { status: "failed", error: error.message });
        }
        throw error;
    }
}

export async function recoverStoredVisionaryHostImages(projectId: string, onTerminal: (record: VisionaryHostOperationRecord) => Promise<boolean> | boolean, signal?: AbortSignal) {
    const records = await listHostOperations(projectId);
    const pendingIds = new Set(records.map((record) => record.clientOperationId));
    while (pendingIds.size) {
        throwIfAborted(signal);
        const current = (await listHostOperations(projectId)).filter((record) => pendingIds.has(record.clientOperationId));
        if (!current.length) return;

        for (const record of current.filter((item) => item.status === "completed" || item.status === "failed")) {
            if (await onTerminal(record)) {
                await acknowledgeHostOperation(record.clientOperationId);
                pendingIds.delete(record.clientOperationId);
            }
        }

        const active = current.filter((record) => record.status === "submitting" || record.status === "pending");
        if (!active.length) {
            await abortableDelay(2000, signal);
            continue;
        }
        const recovery = await recoverVisionaryHostImageBatch(
            active.map((record) => record.clientOperationId),
            signal,
        );
        for (const result of recovery.results) {
            const patch = recoveryPatch(result);
            if ((result.status === "completed" || result.status === "success") && result.id) {
                patch.imageUrl = visionaryHostMediaUrl(result.id);
            }
            if ((result.status === "completed" || result.status === "success") && !result.id) {
                patch.status = "failed";
                patch.error = "图片任务已完成，但没有返回生成记录。";
            }
            if (recovery.credits != null) {
                patch.billing = {
                    state: result.status === "failed" ? "refunded" : result.status === "completed" || result.status === "success" ? "settled" : "reserved",
                    reservedCredits: Math.max(0, Number(result.chargedCredits) || 0),
                    chargedCredits: Math.max(0, Number(result.chargedCredits) || 0),
                    refundedCredits: 0,
                    remainingCredits: recovery.credits,
                };
            }
            await updateHostOperation(result.operationId, patch);
            if (patch.billing) publishBilling(patch.billing);
        }
        await abortableDelay(Math.max(1, recovery.retryAfterSeconds || 2) * 1000, signal);
    }
}

export async function requestVisionaryHostText(context: VisionaryHostRequestContext, content: string, model: string, onDelta: (text: string) => void, options?: { signal?: AbortSignal }) {
    const modelKey = normalizeHostedModel(model);
    if (!content.trim()) throw new Error("请输入文本生成要求。");
    const capabilities = await fetchVisionaryHostTextCapabilities(options?.signal);
    if (!capabilities.enabled) throw new Error("AI 文本功能当前不可用。");
    const selectedModel = capabilities.models.some((item) => item.key === modelKey) ? modelKey : capabilities.defaultModel;
    const conversation = await getOrCreateTextConversation(context, selectedModel, options?.signal);
    const run = await createTextRun(conversation.conversationId, context.clientOperationId, content, options?.signal);
    if (run.reservation?.remainingCredits != null) {
        publishBilling({
            state: "reserved",
            reservedCredits: Math.max(0, Number(run.reservation.reservedCredits) || 0),
            chargedCredits: 0,
            refundedCredits: 0,
            remainingCredits: Number(run.reservation.remainingCredits),
        });
    }

    const cancel = () => {
        void cancelVisionaryHostTextRun(run.runId).catch(() => undefined);
    };
    options?.signal?.addEventListener("abort", cancel, { once: true });
    try {
        return await streamVisionaryHostTextRun(run.runId, onDelta, options?.signal);
    } finally {
        options?.signal?.removeEventListener("abort", cancel);
    }
}

export async function cancelVisionaryHostTextRun(runId: string) {
    const response = await hostResponse(`/text/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
    if (!response.ok && response.status !== 409) {
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        throw responseError(response.status, payload, "停止文本生成失败。");
    }
}

async function pollVisionaryHostImage(operationId: string, initialRetrySeconds: number, signal?: AbortSignal): Promise<VisionaryHostImageResponse> {
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
            const error = result.error || (result.status === "not_found" ? "找不到对应的生图任务。" : "图片生成失败。");
            await updateHostOperation(operationId, { status: "failed", error });
            throw new Error(error);
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
    const blobs = await Promise.all(references.map(referenceImageBlob));
    blobs.forEach((blob, index) => form.append("images", blob, `reference-${index + 1}.${imageExtension(blob.type)}`));
    return form;
}

async function referenceImageBlob(image: ReferenceImage) {
    const stored = image.storageKey ? await getImageBlob(image.storageKey) : null;
    if (stored) return assertImageBlob(stored);
    const source = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!source) throw new Error("参考图片已丢失，无法提交生成。");
    try {
        return assertImageBlob(await (await fetch(source)).blob());
    } catch {
        throw new Error("参考图片读取失败，请重新上传后再试。");
    }
}

function assertImageBlob(blob: Blob) {
    if (!blob.type.startsWith("image/")) throw new Error("参考文件不是有效图片。");
    return blob;
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

async function streamVisionaryHostTextRun(runId: string, onDelta: (text: string) => void, signal?: AbortSignal) {
    let output = "";
    let lastEventId = "";
    let terminal = false;
    let terminalError = "";
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
            if (frame.event === "run.snapshot" && isRecord(frame.data.message) && typeof frame.data.message.content === "string") {
                output = frame.data.message.content;
                onDelta(output);
            }
            if (frame.event === "run.completed") {
                terminal = true;
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
                }
            }
            if (frame.event === "run.cancelled" || frame.event === "run.error") {
                terminal = true;
                terminalError = typeof frame.data.error === "string" ? frame.data.error : frame.event === "run.cancelled" ? "请求已取消" : "文本生成失败。";
                const remainingCredits = Number(frame.data.remainingCredits);
                if (Number.isFinite(remainingCredits)) {
                    publishBilling({
                        state: "refunded",
                        reservedCredits: 0,
                        chargedCredits: 0,
                        refundedCredits: 0,
                        remainingCredits,
                    });
                }
            }
            if (frame.event === "done") terminal = true;
        });
        if (!terminal) {
            reconnects += 1;
            if (reconnects > 5) throw new Error("文本生成连接已中断，请稍后重试。");
            await abortableDelay(Math.min(1000 * 2 ** reconnects, 5000), signal);
        }
    }
    if (terminalError) throw new Error(terminalError);
    if (!output.trim()) throw new Error("文本模型没有返回内容。");
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
        if (!csrfToken) throw new Error("画布安全令牌缺失，请返回主站重新打开画布。");
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
    if (!ratio || ratio === "auto") return "1:1";
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
