import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";
import { VISIONARY_HOSTED } from "@/constant/visionary-hosted";
import { isCurrentVisionaryHostStorageKey, visionaryHostStorageKey } from "@/services/api/visionary-host/storage-namespace";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const objectUrls = new Map<string, string>();
const IMAGE_GC_GRACE_MS = 5 * 60_000;

type StoredImageValue =
    | Blob
    | {
          blob: Blob;
          createdAt: number;
      };

function storedImageBlob(value: StoredImageValue | null) {
    return value instanceof Blob ? value : value?.blob || null;
}

function storedImageCreatedAt(value: StoredImageValue | null) {
    return value instanceof Blob ? 0 : value?.createdAt || 0;
}

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const blob = typeof input === "string" ? await imageInputToBlob(input) : input;
    const storageKey = visionaryHostStorageKey(`image:${nanoid()}`);
    await store.setItem(storageKey, { blob, createdAt: Date.now() } satisfies StoredImageValue);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    try {
        const meta = await readImageMeta(url);
        return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
    } catch (error) {
        objectUrls.delete(storageKey);
        URL.revokeObjectURL(url);
        await store.removeItem(storageKey).catch(() => undefined);
        throw error;
    }
}

async function imageInputToBlob(input: string) {
    if (!input.startsWith("data:")) return (await fetch(input)).blob();
    const separator = input.indexOf(",");
    if (separator < 0) throw new Error("图片数据格式无效");
    const header = input.slice(0, separator);
    const body = input.slice(separator + 1);
    const mimeType = header.match(/^data:([^;,]+)/i)?.[1] || "application/octet-stream";
    if (/;base64/i.test(header)) {
        const binary = atob(body);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        return new Blob([bytes], { type: mimeType });
    }
    return new Blob([decodeURIComponent(body)], { type: mimeType });
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    if (!isCurrentVisionaryHostStorageKey(storageKey, "image:")) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = storedImageBlob(await store.getItem<StoredImageValue>(storageKey));
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    if (!isCurrentVisionaryHostStorageKey(storageKey, "image:")) return null;
    return storedImageBlob(await store.getItem<StoredImageValue>(storageKey));
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    if (VISIONARY_HOSTED && !isCurrentVisionaryHostStorageKey(storageKey, "image:")) {
        throw new Error("图片不属于当前画布账号。");
    }
    await store.setItem(storageKey, { blob, createdAt: Date.now() } satisfies StoredImageValue);
    const previousUrl = objectUrls.get(storageKey);
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys))
            .filter((key) => isCurrentVisionaryHostStorageKey(key, "image:"))
            .map(async (key) => {
                const url = objectUrls.get(key);
                if (url) URL.revokeObjectURL(url);
                objectUrls.delete(key);
                await store.removeItem(key);
            }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    const unused: string[] = [];
    const now = Date.now();
    await store.iterate<StoredImageValue, void>((value, key) => {
        if (!isCurrentVisionaryHostStorageKey(key, "image:")) return;
        if (!usedKeys.has(key) && now - storedImageCreatedAt(value) >= IMAGE_GC_GRACE_MS) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && isCurrentVisionaryHostStorageKey(value.storageKey, "image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}
