import { clearHostImageDelivery, getHostImageDelivery, setHostImageDelivery } from "@/stores/canvas/use-host-image-delivery-store";
import type { VisionaryHostOperationRecord } from "./operations";
import { visionaryHostStorageKey } from "./storage-namespace";

const running = new Set<string>();
const retries = new Map<string, { attempts: number; after: number }>();
const MAX_CONCURRENT_DELIVERIES = 2;

export function resetImageDeliveryRetry(operationId: string) {
    retries.delete(visionaryHostStorageKey(operationId));
}

// Delivery never owns the status scanner. A slow result cannot delay admission
// guard restoration or prevent another generation's status from being queried.
export function scheduleImageDeliveries(records: VisionaryHostOperationRecord[], signal: AbortSignal | undefined, deliver: (record: VisionaryHostOperationRecord) => Promise<boolean>) {
    const candidates = records.filter((record) => record.status === "completed" || record.status === "failed");
    for (const record of candidates) {
        if (signal?.aborted || running.size >= MAX_CONCURRENT_DELIVERIES) break;
        const key = visionaryHostStorageKey(record.clientOperationId);
        const retry = retries.get(key);
        if (running.has(key) || (retry && (Date.now() < retry.after || (retry.attempts >= 5 && getHostImageDelivery(record.clientOperationId)?.status === "failed")))) continue;
        running.add(key);
        void deliver(record)
            .then((delivered) => {
                if (signal?.aborted) return;
                if (delivered) {
                    retries.delete(key);
                    clearHostImageDelivery(record.clientOperationId);
                } else {
                    const attempts = (retry?.attempts || 0) + 1;
                    retries.set(key, { attempts, after: Date.now() + Math.min(60_000, 3_000 * 2 ** Math.min(attempts, 5)) });
                    if (record.status === "completed" && getHostImageDelivery(record.clientOperationId)?.status === "receiving") {
                        setHostImageDelivery({ projectId: record.projectId, operationId: record.clientOperationId, status: "failed", error: "领取或保存确认暂未完成，可重新领取原图，不会再次扣分。" });
                    }
                }
            })
            .catch(() => {
                if (signal?.aborted) return;
                retries.set(key, { attempts: (retry?.attempts || 0) + 1, after: Date.now() + 30_000 });
                if (record.status === "completed") setHostImageDelivery({ projectId: record.projectId, operationId: record.clientOperationId, status: "failed", error: "领取暂未完成，可重新领取原图，不会再次扣分。" });
            })
            .finally(() => running.delete(key));
    }
}
