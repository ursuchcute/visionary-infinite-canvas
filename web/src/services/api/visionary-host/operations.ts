import localforage from "localforage";

import type { VisionaryHostBilling, VisionaryHostImageRecoveryResult, VisionaryHostRequestContext } from "./contracts";
import { isCurrentVisionaryHostStorageKey, visionaryHostStorageKey } from "./storage-namespace";

export type VisionaryHostOperationRecord = VisionaryHostRequestContext & {
    kind: "image";
    status: "submitting" | "pending" | "completed" | "failed";
    generationId?: string;
    imageUrl?: string;
    error?: string;
    billing?: VisionaryHostBilling;
    createdAt: number;
    updatedAt: number;
};

const operationStore = localforage.createInstance({
    name: "infinite-canvas",
    storeName: "visionary_host_operations",
});

const MAX_OPERATION_AGE_MS = 24 * 60 * 60 * 1000;

export async function saveHostOperation(record: VisionaryHostOperationRecord) {
    await operationStore.setItem(visionaryHostStorageKey(record.clientOperationId), record);
}

export async function updateHostOperation(clientOperationId: string, patch: Partial<VisionaryHostOperationRecord>) {
    const key = visionaryHostStorageKey(clientOperationId);
    const current = await operationStore.getItem<VisionaryHostOperationRecord>(key);
    if (!current) return;
    await operationStore.setItem(key, { ...current, ...patch, updatedAt: Date.now() });
}

export async function acknowledgeHostOperation(clientOperationId: string) {
    await operationStore.removeItem(visionaryHostStorageKey(clientOperationId));
}

export async function listHostOperations(projectId: string) {
    const records: VisionaryHostOperationRecord[] = [];
    const expired: string[] = [];
    const now = Date.now();
    await operationStore.iterate<VisionaryHostOperationRecord, void>((record, key) => {
        if (!isCurrentVisionaryHostStorageKey(key)) return;
        if (!record || record.kind !== "image") return;
        if (now - record.updatedAt > MAX_OPERATION_AGE_MS) {
            expired.push(key);
            return;
        }
        if (record.projectId === projectId) records.push(record);
    });
    await Promise.all(expired.map((key) => operationStore.removeItem(key)));
    return records.sort((a, b) => a.createdAt - b.createdAt);
}

export function recoveryPatch(result: VisionaryHostImageRecoveryResult): Partial<VisionaryHostOperationRecord> {
    if (result.status === "completed" || result.status === "success") {
        return {
            status: "completed",
            generationId: result.id,
            error: undefined,
        };
    }
    if (result.status === "failed" || result.status === "not_found") {
        return {
            status: "failed",
            error: result.error || (result.status === "not_found" ? "找不到对应的生图任务。" : "图片生成失败。"),
        };
    }
    return { status: "pending" };
}
