import localforage from "localforage";
import { useVisionaryHostStore } from "@/stores/use-visionary-host-store";
import { hostJson, refreshVisionaryHostCredits, VisionaryHostApiError, VisionaryHostOperationPendingError } from "./client";
import { withRequestBudget } from "./request-budget";
import { visionaryHostStorageKey, isCurrentVisionaryHostStorageKey } from "./storage-namespace";
import type { VisionaryHostRequestContext, VisionaryHostVideoModel } from "./contracts";
import type { HostOperationRequestOptions } from "./client";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { getImageBlob } from "@/services/image-storage";
import { prepareReferenceImageForUpload } from "@/lib/reference-image-compression";
import { resolveHostedVideoParameters } from "@/hosted/video-parameters";

export type HostedVideoTask = { id: string; clientRequestId: string; status: string; billingStatus?: string; chargedCredits?: number; refundedCredits?: number; error?: string | null };
export type HostedVideoOperation = VisionaryHostRequestContext & { kind: "video"; phase: "preflight" | "submitted" | "failed"; body: Record<string, unknown>; task?: HostedVideoTask; error?: string; createdAt: number };
const store = localforage.createInstance({ name: "infinite-canvas", storeName: "visionary_host_video_operations" });
const submitting = new Set<string>();
export const isHostedVideoSubmitting = (id: string) => submitting.has(id);
const writes = new Map<string, Promise<unknown>>();
async function write<T>(id: string, run: (key: string) => Promise<T>) {
    const key = visionaryHostStorageKey(id);
    const pending = (writes.get(key) || Promise.resolve()).catch(() => undefined).then(() => run(key));
    writes.set(key, pending);
    try {
        return await pending;
    } finally {
        if (writes.get(key) === pending) writes.delete(key);
    }
}
export async function listHostedVideos(projectId: string) {
    const records: HostedVideoOperation[] = [];
    await withRequestBudget(undefined, 15_000, () =>
        store.iterate<HostedVideoOperation, void>((record, key) => {
            if (isCurrentVisionaryHostStorageKey(key) && record.projectId === projectId) records.push(record);
        }),
    );
    return records;
}
export async function releaseHostedVideoSlot(record: HostedVideoOperation, signal?: AbortSignal) {
    if (!record.task || !terminal(record.task)) return;
    await hostJson(`/videos/tasks/${encodeURIComponent(record.task.id)}/dismiss`, { method: "POST", signal });
}
export const removeHostedVideo = (id: string) => write(id, (key) => store.removeItem(key));
async function save(record: HostedVideoOperation) {
    return write(record.clientOperationId, async (key) => {
        const current = await store.getItem<HostedVideoOperation>(key);
        if (terminal(current?.task) || (record.phase === "failed" && current?.task)) return false;
        await store.setItem(key, { ...record, ...(current?.task ? { task: current.task } : {}) });
        return true;
    });
}
function terminal(task?: HostedVideoTask) {
    return (task?.status === "completed" && ["settled", "refunded"].includes(task.billingStatus || "")) || ((task?.status === "failed" || task?.status === "cancelled") && task.billingStatus === "refunded");
}
export async function saveHostedVideoTask(record: HostedVideoOperation, task: HostedVideoTask) {
    if (!task?.id || task.clientRequestId !== record.clientOperationId) throw new Error("视频任务身份不一致，请勿重复提交。");
    return withRequestBudget(undefined, 15_000, () =>
        write(record.clientOperationId, async (key) => {
            const current = await store.getItem<HostedVideoOperation>(key);
            if (!current || terminal(current.task)) return current;
            if (current.task && current.task.id !== task.id) throw new Error("视频任务标识发生变化，请继续确认原任务。");
            const next = { ...current, task };
            await store.setItem(key, next);
            return next;
        }),
    );
}
async function uploadReference(reference: ReferenceImage, signal?: AbortSignal) {
    return withRequestBudget(signal, 60_000, async (uploadSignal) => {
        let source: Blob | null;
        if (reference.storageKey) source = await getImageBlob(reference.storageKey);
        else {
            const response = await fetch(reference.dataUrl, { signal: uploadSignal });
            if (!response.ok) throw new Error("参考图片读取失败，请重新上传。");
            source = await response.blob();
        }
        if (!source) throw new Error("参考图片已丢失，请重新上传。");
        const blob = await prepareReferenceImageForUpload(source, 4 * 1024 * 1024);
        uploadSignal.throwIfAborted();
        const ticket = await hostJson<{ id: string; uploadUrl: string; headers: Record<string, string> }>("/videos/references/upload-url", {
            method: "POST",
            signal: uploadSignal,
            body: JSON.stringify({ kind: "image", contentType: blob.type, size: blob.size, filename: reference.name }),
        });
        const target = new URL(ticket.uploadUrl);
        if (target.protocol !== "https:") throw new Error("参考图片上传地址无效。");
        const uploaded = await fetch(ticket.uploadUrl, { method: "PUT", headers: ticket.headers, body: blob, signal: uploadSignal });
        if (!uploaded.ok) throw new Error("参考图片上传失败，请重试。");
        const result = await hostJson<{ url: string }>(`/videos/references/${encodeURIComponent(ticket.id)}/complete`, { method: "POST", signal: uploadSignal });
        if (!result.url?.startsWith("https://")) throw new Error("参考图片读取地址无效。");
        return result.url;
    });
}

export async function submitHostedVideo(context: VisionaryHostRequestContext, config: AiConfig, models: VisionaryHostVideoModel[], prompt: string, references: ReferenceImage[], options: HostOperationRequestOptions) {
    const params = resolveHostedVideoParameters(config, models, references.length);
    if (!params || !params.model.acceptingSubmissions || params.credits == null) throw new Error("当前视频模型或积分配置暂不可用。");
    if (!prompt.trim() || prompt.length > 10_000) throw new Error("视频提示词需要 1–10000 个字。");
    if (references.length > params.model.config.imageMax) throw new Error(`当前模型最多支持 ${params.model.config.imageMax} 张参考图。`);
    const urls: string[] = [];
    for (const reference of references) urls.push(await uploadReference(reference, options.signal));
    options.signal?.throwIfAborted();
    const record: HostedVideoOperation = {
        ...context,
        kind: "video",
        phase: "preflight",
        createdAt: Date.now(),
        body: {
            clientRequestId: context.clientOperationId,
            prompt: prompt.trim(),
            duration: params.duration,
            resolution: params.resolution,
            aspectRatio: params.ratio,
            expectedCredits: params.credits,
            referenceImages: urls,
            model: params.model.id,
            ...(params.model.id === "grok-imagine-video-1.5" ? { mode: urls.length === 0 ? "text" : urls.length === 1 ? "image" : "reference" } : {}),
        },
    };
    let dispatched = false;
    submitting.add(context.clientOperationId);
    try {
        await options.onHostOperationTargetReady?.(context);
        await withRequestBudget(options.signal, 15_000, () => save(record));
        await options.onHostOperationDurable?.(context);
        options.signal?.throwIfAborted();
        record.phase = "submitted";
        await withRequestBudget(options.signal, 15_000, () => save(record));
        options.signal?.throwIfAborted();
        dispatched = true;
        const response = await hostJson<{ task: HostedVideoTask }>(`/videos/models/${encodeURIComponent(params.model.id)}/tasks`, { method: "POST", signal: options.signal, body: JSON.stringify(record.body) });
        await saveHostedVideoTask(record, response.task);
        void refreshVisionaryHostCredits("settled").catch(() => undefined);
    } catch (error) {
        const rejected =
            error instanceof VisionaryHostApiError &&
            ((error.status >= 400 && error.status < 500 && error.status !== 409) || ["video_price_changed", "video_price_missing", "video_model_disabled", "video_submissions_disabled", "provider_unavailable"].includes(error.code || ""));
        if (rejected)
            void useVisionaryHostStore
                .getState()
                .refreshVideoConfiguration()
                .catch(() => undefined);
        if (!dispatched || rejected) {
            // Persist this known non-admission before clearing the node guard.
            record.phase = "failed";
            record.error = error instanceof Error ? error.message : "视频未提交。";
            try {
                const cleared = await withRequestBudget(undefined, 15_000, () => save(record));
                if (!cleared) throw new Error("视频任务已经被接收，继续恢复。");
                await options.onHostOperationPreflightFailed?.(context);
                await withRequestBudget(undefined, 15_000, () => removeHostedVideo(context.clientOperationId));
            } catch {
                throw new VisionaryHostOperationPendingError(context.clientOperationId, context.nodeId, "本地视频任务记录仍在恢复，请稍后再试。");
            }
            throw error;
        }
    } finally {
        submitting.delete(context.clientOperationId);
    }
    throw new VisionaryHostOperationPendingError(context.clientOperationId, context.nodeId, "视频已转入后台确认，可以继续编辑其他节点；停止等待不会取消或重复生成。");
}

// Unknown admission is retried only with the original immutable body/key.
// The server's atomic reservation is shared with the ordinary video page.
export async function recoverHostedVideo(record: HostedVideoOperation, signal: AbortSignal) {
    if (record.phase === "failed") return record;
    if (record.phase === "preflight") return Date.now() - record.createdAt >= 120_000 ? { ...record, phase: "failed" as const, error: "视频在提交前已中断，未扣除积分。" } : record;
    if (terminal(record.task)) return record;
    let task: HostedVideoTask | null;
    if (record.task?.id) ({ task } = await hostJson<{ task: HostedVideoTask }>(`/videos/tasks/${encodeURIComponent(record.task.id)}`, { signal }));
    else {
        ({ task } = await hostJson<{ task: HostedVideoTask | null }>(`/videos/requests/${encodeURIComponent(record.clientOperationId)}`, { signal }));
        if (!task && Date.now() - record.createdAt >= 2 * 60 * 60 * 1000) {
            // A stale browser record must never start a new paid task months
            // later. Existing server tasks are still recovered above.
            signal.throwIfAborted();
            const expired = { ...record, phase: "failed" as const, error: "视频提交一直未被服务端确认，已停止自动重试，请重新生成。" };
            return (await withRequestBudget(signal, 15_000, () => save(expired))) ? expired : record;
        }
        if (!task) {
            try {
                ({ task } = await hostJson<{ task: HostedVideoTask }>(`/videos/models/${encodeURIComponent(String(record.body.model))}/tasks`, { method: "POST", signal, body: JSON.stringify(record.body) }));
            } catch (error) {
                // Price rejection is checked inside the same atomic request
                // reservation. Recheck ownership before releasing its guard.
                if (!(error instanceof VisionaryHostApiError) || !["video_price_changed", "video_price_missing"].includes(error.code || "")) throw error;
                ({ task } = await hostJson<{ task: HostedVideoTask | null }>(`/videos/requests/${encodeURIComponent(record.clientOperationId)}`, { signal }));
                if (!task) {
                    signal.throwIfAborted();
                    const rejected = { ...record, phase: "failed" as const, error: error.message };
                    const saved = await withRequestBudget(signal, 15_000, () => save(rejected));
                    void useVisionaryHostStore
                        .getState()
                        .refreshVideoConfiguration()
                        .catch(() => undefined);
                    return saved ? rejected : record;
                }
            }
        }
    }
    signal.throwIfAborted();
    if (!task) throw new Error("视频状态暂时无法确认。");
    return (await saveHostedVideoTask(record, task)) || record;
}

export function hostedVideoNodeMetadata(record: HostedVideoOperation) {
    const task = record.task;
    const succeeded = task?.status === "completed" && task.billingStatus === "settled";
    const failed = record.phase === "failed" || task?.billingStatus === "refunded";
    return {
        hostOperationId: record.clientOperationId,
        hostVideoTaskId: task?.id,
        status: succeeded ? ("success" as const) : failed ? ("error" as const) : ("loading" as const),
        seconds: String(record.body.duration),
        size: String(record.body.aspectRatio),
        vquality: String(record.body.resolution),
        ...(succeeded ? { content: `/api/canvas/v1/videos/tasks/${encodeURIComponent(task!.id)}/content`, storageKey: undefined, mimeType: "video/mp4", durationMs: Number(record.body.duration) * 1000, chargedCredits: task?.chargedCredits } : {}),
        errorDetails: succeeded
            ? undefined
            : failed
              ? record.error || task?.error || "视频生成失败，积分已退回。"
              : task?.status === "attention_required"
                ? "视频提交或结果待确认，请勿重复生成；系统将继续核对。"
                : task?.status === "completed"
                  ? "视频已完成，正在确认积分结算。"
                  : task?.status === "failed" || task?.status === "cancelled"
                    ? "视频生成未完成，正在核对积分退款，请勿重复生成。"
                    : "视频正在生成，可以继续编辑其他节点。",
    };
}
