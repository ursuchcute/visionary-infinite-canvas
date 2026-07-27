import localforage from "localforage";

import type { VisionaryHostBilling, VisionaryHostRequestContext } from "./contracts";
import { isCurrentVisionaryHostStorageKey, visionaryHostStorageKey } from "./storage-namespace";

export { isHostAdmissionBlocking, recoveryPatch, shouldMarkTextRecoveryClientFailure } from "./operation-state";

export type VisionaryHostOperationRecord = VisionaryHostRequestContext & {
    kind: "image";
    admissionNodeId?: string;
    admissionGroupId?: string;
    status: "preflight" | "submitting" | "pending" | "completed" | "failed";
    generationId?: string;
    imageUrl?: string;
    error?: string;
    billing?: VisionaryHostBilling;
    notFoundCount?: number;
    createdAt: number;
    updatedAt: number;
};

export type VisionaryHostTextOperationRecord = VisionaryHostRequestContext & {
    kind: "text";
    admissionNodeId?: string;
    admissionGroupId?: string;
    status: "preflight" | "submitting" | "pending" | "completed" | "failed";
    content: string;
    model: string;
    conversationId: string;
    runId?: string;
    output?: string;
    error?: string;
    createdAt: number;
    updatedAt: number;
};

type VisionaryHostStoredOperationRecord = VisionaryHostOperationRecord | VisionaryHostTextOperationRecord;

const operationStore = localforage.createInstance({
    name: "infinite-canvas",
    storeName: "visionary_host_operations",
});

export async function saveHostOperation(record: VisionaryHostOperationRecord) {
    await operationStore.setItem(visionaryHostStorageKey(record.clientOperationId), record);
}

export async function updateHostOperation(clientOperationId: string, patch: Partial<VisionaryHostOperationRecord>) {
    const key = visionaryHostStorageKey(clientOperationId);
    const current = await operationStore.getItem<VisionaryHostStoredOperationRecord>(key);
    if (!current || current.kind !== "image") return false;
    await operationStore.setItem(key, { ...current, ...patch, updatedAt: Date.now() });
    return true;
}

export async function saveHostTextOperation(record: VisionaryHostTextOperationRecord) {
    await operationStore.setItem(visionaryHostStorageKey(record.clientOperationId), record);
}

export async function updateHostTextOperation(clientOperationId: string, patch: Partial<VisionaryHostTextOperationRecord>) {
    const key = visionaryHostStorageKey(clientOperationId);
    const current = await operationStore.getItem<VisionaryHostStoredOperationRecord>(key);
    if (!current || current.kind !== "text") return false;
    await operationStore.setItem(key, { ...current, ...patch, updatedAt: Date.now() });
    return true;
}

export async function acknowledgeHostOperation(clientOperationId: string) {
    await operationStore.removeItem(visionaryHostStorageKey(clientOperationId));
}

export async function listHostOperations(projectId: string) {
    const records: VisionaryHostOperationRecord[] = [];
    await operationStore.iterate<VisionaryHostStoredOperationRecord, void>((record, key) => {
        if (!isCurrentVisionaryHostStorageKey(key)) return;
        if (!record) return;
        if (record.kind === "image" && record.projectId === projectId) records.push(record);
    });
    return records.sort((a, b) => a.createdAt - b.createdAt);
}

export async function listHostTextOperations(projectId: string) {
    const records: VisionaryHostTextOperationRecord[] = [];
    await operationStore.iterate<VisionaryHostStoredOperationRecord, void>((record, key) => {
        if (!isCurrentVisionaryHostStorageKey(key)) return;
        if (!record) return;
        if (record.kind === "text" && record.projectId === projectId) records.push(record);
    });
    return records.sort((a, b) => a.createdAt - b.createdAt);
}
