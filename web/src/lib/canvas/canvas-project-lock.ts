import { VISIONARY_HOSTED } from "@/constant/visionary-hosted";
import { flushLocalForageStorageWrites } from "@/lib/localforage-storage";

export class CanvasProjectInUseError extends Error {
    constructor() {
        super("画布正在其他页面中打开。");
        this.name = "CanvasProjectInUseError";
    }
}

export class CanvasProjectLockUnsupportedError extends Error {
    constructor() {
        super("浏览器不支持安全画布锁。");
        this.name = "CanvasProjectLockUnsupportedError";
    }
}

// The persisted Canvas store contains the complete projects array, and the
// asset/prompt stores are shared by every project. Hosted mode therefore needs
// one browser-wide writer lease rather than independent per-project locks.
export function canvasStoreLockName() {
    return "visionary-canvas-store";
}

function throwFirstRejected(results: PromiseSettledResult<unknown>[]) {
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejected) throw rejected.reason;
}

export async function reloadHostedCanvasStoresFromPersistence() {
    const [{ reloadCanvasStoreFromPersistence }, { reloadAssetStoreFromPersistence }, { reloadPromptStoreFromPersistence }] = await Promise.all([
        import("@/stores/canvas/use-canvas-store"),
        import("@/stores/use-asset-store"),
        import("@/stores/use-prompt-store"),
    ]);
    await reloadCanvasStoreFromPersistence();
    // Promise.all would reject as soon as one store fails and let its sibling
    // continue rehydrating after the Web Lock is released. Always wait for both
    // shared stores to settle before deciding whether the lease is safe.
    const results = await Promise.allSettled([reloadAssetStoreFromPersistence(), reloadPromptStoreFromPersistence()]);
    throwFirstRejected(results);
}

export async function flushHostedCanvasStoresPersistence() {
    const [{ flushCanvasStorePersistence }, { flushAssetStorePersistence }, { flushPromptStorePersistence }] = await Promise.all([
        import("@/stores/canvas/use-canvas-store"),
        import("@/stores/use-asset-store"),
        import("@/stores/use-prompt-store"),
    ]);
    const storeResults = await Promise.allSettled([flushCanvasStorePersistence(), flushAssetStorePersistence(), flushPromptStorePersistence()]);
    const storageResults = await Promise.allSettled([flushLocalForageStorageWrites()]);
    throwFirstRejected([...storeResults, ...storageResults]);
}

function holdCanvasStoreLeaseUntilDocumentExit(): Promise<never> {
    // There is no authoritative snapshot to hand to the next writer when a
    // rollback read fails. Keep the Web Lock callback pending; the browser
    // releases it automatically when this document is destroyed.
    return new Promise<never>(() => undefined);
}

export async function withHostedCanvasStoreLock<T>(callback: () => Promise<T> | T): Promise<T> {
    if (!VISIONARY_HOSTED) return callback();
    if (typeof navigator === "undefined" || !navigator.locks) {
        throw new CanvasProjectLockUnsupportedError();
    }
    return navigator.locks.request(canvasStoreLockName(), { mode: "exclusive", ifAvailable: true }, async (lock) => {
        if (!lock) throw new CanvasProjectInUseError();
        await reloadHostedCanvasStoresFromPersistence();
        try {
            const result = await callback();
            await flushHostedCanvasStoresPersistence();
            return result;
        } catch (error) {
            // A failed mutation may have queued a rollback snapshot. Clear it
            // and restore the last authoritative state before releasing the
            // global writer lease, so no timer can write after another tab
            // acquires the lease.
            try {
                await reloadHostedCanvasStoresFromPersistence();
            } catch {
                await holdCanvasStoreLeaseUntilDocumentExit();
            }
            throw error;
        }
    });
}
