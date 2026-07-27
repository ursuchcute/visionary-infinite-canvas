import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { cleanupUnusedImages, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";
import { VISIONARY_HOSTED } from "@/constant/visionary-hosted";
import { visionaryHostStorageKey } from "@/services/api/visionary-host/storage-namespace";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
type QueuedAssetPersist = {
    name: string;
    value: StorageValue<AssetStore>;
    snapshot: Asset[];
};
let persistedAssetSnapshot: Asset[] | null = null;
let queuedAssetPersist: QueuedAssetPersist | null = null;
let activeAssetPersist: QueuedAssetPersist | null = null;
let activeAssetPersistWrite: Promise<void> | null = null;

function startAssetStorePersistWrite() {
    if (activeAssetPersistWrite) return activeAssetPersistWrite;
    const queued = queuedAssetPersist;
    if (!queued) return Promise.resolve();
    queuedAssetPersist = null;
    activeAssetPersist = queued;
    activeAssetPersistWrite = (async () => {
        try {
            await localForageStorage.setItem(visionaryHostStorageKey(queued.name), JSON.stringify(queued.value));
            persistedAssetSnapshot = queued.snapshot;
        } catch (error) {
            // Preserve the newest unsaved value. If another update arrived while
            // this write was active, that newer queued value supersedes it.
            if (!queuedAssetPersist) queuedAssetPersist = queued;
            throw error;
        } finally {
            activeAssetPersist = null;
            activeAssetPersistWrite = null;
        }
    })();
    return activeAssetPersistWrite;
}

export async function flushAssetStorePersistence() {
    while (true) {
        const write = activeAssetPersistWrite || (queuedAssetPersist ? startAssetStorePersistWrite() : null);
        if (!write) return;
        await write;
    }
}

export async function reloadAssetStoreFromPersistence() {
    if (activeAssetPersistWrite) {
        try {
            await activeAssetPersistWrite;
        } catch {
            // The authoritative reload below replaces the failed local value.
        }
    }
    queuedAssetPersist = null;
    persistedAssetSnapshot = null;
    await useAssetStore.persist.rehydrate();
}

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(visionaryHostStorageKey(name));
        if (!value) {
            persistedAssetSnapshot = null;
            return null;
        }
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (asset) => {
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind !== "image") return asset;
                if (asset.data.storageKey)
                    return {
                        ...asset,
                        coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
                        data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
                    };
                if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
                // Hosted bootstrap hydration runs before a tab owns the global
                // Canvas writer lease. Keep legacy inline images readable there
                // instead of creating a new IndexedDB blob as a read side effect.
                if (VISIONARY_HOSTED) return asset;
                const image = await uploadImage(asset.data.dataUrl);
                return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
            }),
        );
        persistedAssetSnapshot = parsed.state.assets;
        return parsed;
    },
    setItem: (name, value) => {
        const snapshot = value.state.assets;
        if (persistedAssetSnapshot === snapshot && !activeAssetPersistWrite && !queuedAssetPersist) return;
        if (activeAssetPersist?.snapshot === snapshot && !queuedAssetPersist) return;
        queuedAssetPersist = { name, value, snapshot };
        // Zustand callers are synchronous and do not observe a returned
        // rejection. The explicit Hosted flush API owns error reporting/retry.
        void flushAssetStorePersistence().catch(() => undefined);
    },
    removeItem: (name) => localForageStorage.removeItem(visionaryHostStorageKey(name)),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            removeAsset: (id) =>
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    // Hosted callers confirm the shared asset snapshot is
                    // durable before starting destructive blob cleanup.
                    if (!VISIONARY_HOSTED) get().cleanupImages({ assets });
                    return { assets };
                }),
            replaceAssets: (assets) => set({ assets }),
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
            skipHydration: VISIONARY_HOSTED,
            onRehydrateStorage: () => () => {
                useAssetStore.setState({ hydrated: true });
            },
        },
    ),
);
