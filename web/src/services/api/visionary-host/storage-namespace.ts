import { VISIONARY_HOSTED } from "@/constant/visionary-hosted";

const HOSTED_STORAGE_PREFIX = "visionary-host";
let activeStorageNamespace = "";

export function setVisionaryHostStorageNamespace(namespace: string) {
    if (!VISIONARY_HOSTED) return false;
    const normalized = namespace.trim();
    if (!normalized || normalized.length > 256) throw new Error("画布存储命名空间无效，请返回主站重新打开画布。");
    if (activeStorageNamespace && activeStorageNamespace !== normalized) {
        throw new Error("画布账号已切换，请刷新页面后重新打开。");
    }
    const changed = !activeStorageNamespace;
    activeStorageNamespace = normalized;
    return changed;
}

export function visionaryHostStorageKey(logicalKey: string) {
    if (!VISIONARY_HOSTED) return logicalKey;
    return `${currentVisionaryHostStoragePrefix()}${logicalKey}`;
}

export function isCurrentVisionaryHostStorageKey(storageKey: string, logicalPrefix = "") {
    if (!VISIONARY_HOSTED) return storageKey.startsWith(logicalPrefix);
    return storageKey.startsWith(`${currentVisionaryHostStoragePrefix()}${logicalPrefix}`);
}

function currentVisionaryHostStoragePrefix() {
    if (!activeStorageNamespace) throw new Error("画布存储尚未初始化，请返回主站重新打开画布。");
    return `${HOSTED_STORAGE_PREFIX}:${encodeURIComponent(activeStorageNamespace)}:`;
}
