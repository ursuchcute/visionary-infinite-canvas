import localforage from "localforage";

import type { CanvasProjectCoverSource } from "@/lib/canvas/canvas-project-cover";
import { resolveImageUrl } from "@/services/image-storage";
import { visionaryHostStorageKey } from "@/services/api/visionary-host/storage-namespace";

const COVER_WIDTH = 640;
const COVER_HEIGHT = 360;
const COVER_QUALITY = 0.78;

type StoredProjectCover = {
    fingerprint: string;
    blob: Blob;
};

const coverStore = localforage.createInstance({
    name: "infinite-canvas",
    storeName: "project_cover_thumbnails",
});
const objectUrls = new Map<string, { fingerprint: string; url: string }>();
const pendingCovers = new Map<string, Promise<string | null>>();
const latestFingerprintByProject = new Map<string, string>();
const generationQueue: Array<{ source: CanvasProjectCoverSource; resolve: (url: string | null) => void }> = [];
let generationQueueRunning = false;

export async function getCachedCanvasProjectCover(source: CanvasProjectCoverSource) {
    latestFingerprintByProject.set(source.projectId, source.fingerprint);
    const memory = objectUrls.get(source.projectId);
    if (memory?.fingerprint === source.fingerprint) return memory.url;

    const stored = await coverStore.getItem<StoredProjectCover>(visionaryHostStorageKey(source.projectId));
    if (latestFingerprintByProject.get(source.projectId) !== source.fingerprint) return null;
    if (!stored || stored.fingerprint !== source.fingerprint || !(stored.blob instanceof Blob)) return null;
    return cacheObjectUrl(source, stored.blob);
}

export async function resolveCanvasProjectCoverOriginal(source: CanvasProjectCoverSource) {
    if (source.storageKey) return resolveImageUrl(source.storageKey, source.url);
    return source.url;
}

export function ensureCanvasProjectCover(source: CanvasProjectCoverSource) {
    latestFingerprintByProject.set(source.projectId, source.fingerprint);
    const pendingKey = `${source.projectId}:${source.fingerprint}`;
    const current = pendingCovers.get(pendingKey);
    if (current) return current;

    const pending = enqueueCanvasProjectCover(source).finally(() => pendingCovers.delete(pendingKey));
    pendingCovers.set(pendingKey, pending);
    return pending;
}

export async function deleteCanvasProjectCovers(projectIds: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(projectIds)).map(async (projectId) => {
            const memory = objectUrls.get(projectId);
            if (memory) URL.revokeObjectURL(memory.url);
            objectUrls.delete(projectId);
            latestFingerprintByProject.delete(projectId);
            await coverStore.removeItem(visionaryHostStorageKey(projectId));
        }),
    );
}

async function createCanvasProjectCover(source: CanvasProjectCoverSource) {
    if (latestFingerprintByProject.get(source.projectId) !== source.fingerprint) return null;
    const cached = await getCachedCanvasProjectCover(source);
    if (cached) return cached;
    if (latestFingerprintByProject.get(source.projectId) !== source.fingerprint) return null;
    const sourceUrl = await resolveCanvasProjectCoverOriginal(source);
    if (!sourceUrl) return null;
    const image = await loadImage(sourceUrl);
    if (!image) return null;
    const blob = await renderThumbnail(image);
    if (!blob) return null;
    if (latestFingerprintByProject.get(source.projectId) !== source.fingerprint) return null;
    const storageKey = visionaryHostStorageKey(source.projectId);
    await coverStore.setItem<StoredProjectCover>(storageKey, {
        fingerprint: source.fingerprint,
        blob,
    });
    if (latestFingerprintByProject.get(source.projectId) !== source.fingerprint) {
        const stored = await coverStore.getItem<StoredProjectCover>(storageKey);
        if (stored?.fingerprint === source.fingerprint) await coverStore.removeItem(storageKey);
        return null;
    }
    return cacheObjectUrl(source, blob);
}

function enqueueCanvasProjectCover(source: CanvasProjectCoverSource) {
    const pending = new Promise<string | null>((resolve) => {
        generationQueue.push({ source, resolve });
    });
    void drainGenerationQueue();
    return pending;
}

async function drainGenerationQueue() {
    if (generationQueueRunning) return;
    generationQueueRunning = true;
    try {
        while (generationQueue.length) {
            const task = generationQueue.shift();
            if (!task) continue;
            await waitForIdle();
            try {
                task.resolve(await createCanvasProjectCover(task.source));
            } catch {
                task.resolve(null);
            }
            await yieldToMainThread();
        }
    } finally {
        generationQueueRunning = false;
        if (generationQueue.length) void drainGenerationQueue();
    }
}

function cacheObjectUrl(source: CanvasProjectCoverSource, blob: Blob) {
    const previous = objectUrls.get(source.projectId);
    if (previous) URL.revokeObjectURL(previous.url);
    const url = URL.createObjectURL(blob);
    objectUrls.set(source.projectId, { fingerprint: source.fingerprint, url });
    return url;
}

function waitForIdle() {
    return new Promise<void>((resolve) => {
        if (typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(() => resolve(), { timeout: 1200 });
        } else {
            window.setTimeout(resolve, 0);
        }
    });
}

function yieldToMainThread() {
    return new Promise<void>((resolve) => window.setTimeout(resolve, 32));
}

function loadImage(url: string) {
    return new Promise<HTMLImageElement | null>((resolve) => {
        const image = new Image();
        image.decoding = "async";
        if (/^https?:/i.test(url) && !url.startsWith(window.location.origin)) image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = url;
    });
}

function renderThumbnail(image: HTMLImageElement) {
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) return Promise.resolve<Blob | null>(null);

    const sourceRatio = sourceWidth / sourceHeight;
    const targetRatio = COVER_WIDTH / COVER_HEIGHT;
    const cropWidth = sourceRatio > targetRatio ? sourceHeight * targetRatio : sourceWidth;
    const cropHeight = sourceRatio > targetRatio ? sourceHeight : sourceWidth / targetRatio;
    const cropX = (sourceWidth - cropWidth) / 2;
    const cropY = (sourceHeight - cropHeight) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = COVER_WIDTH;
    canvas.height = COVER_HEIGHT;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return Promise.resolve<Blob | null>(null);
    context.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, COVER_WIDTH, COVER_HEIGHT);

    return new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/webp", COVER_QUALITY);
    });
}
