import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";
import { VISIONARY_HOSTED } from "@/constant/visionary-hosted";

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
});

// If IndexedDB is temporarily unavailable, keep a durable override in
// localStorage. Reads must prefer that override; otherwise an older IndexedDB
// value can shadow a newer fallback write and make a successfully flushed
// Hosted recovery disappear after refresh.
const REMOVED_STORAGE_VALUE = "__infinite_canvas_removed__";
const STORAGE_OVERRIDE_VERSION = "1";
const storageOverrideKey = (name: string) => `${name}:__local_override_v1`;
const pendingStorageWrites = new Set<Promise<void>>();
const latestStorageWriteSequence = new Map<string, number>();
const pendingStorageWriteErrors = new Map<string, unknown>();
let storageWriteSequence = 0;

function trackStorageWrite(name: string, write: Promise<void>) {
    const sequence = ++storageWriteSequence;
    latestStorageWriteSequence.set(name, sequence);
    pendingStorageWrites.add(write);
    void write.then(
        () => {
            pendingStorageWrites.delete(write);
            if (latestStorageWriteSequence.get(name) === sequence) pendingStorageWriteErrors.delete(name);
        },
        (error) => {
            pendingStorageWrites.delete(write);
            if (latestStorageWriteSequence.get(name) === sequence) pendingStorageWriteErrors.set(name, error);
        },
    );
    return write;
}

export async function flushLocalForageStorageWrites() {
    while (pendingStorageWrites.size) {
        await Promise.allSettled(Array.from(pendingStorageWrites));
    }
    const error = pendingStorageWriteErrors.values().next();
    if (!error.done) throw error.value;
}

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        const overrideKey = storageOverrideKey(name);
        const hasCurrentOverride = window.localStorage.getItem(overrideKey) === STORAGE_OVERRIDE_VERSION;
        const fallback = window.localStorage.getItem(name);
        if (hasCurrentOverride && fallback !== null) {
            // Reads are deliberately side-effect free. Rehydration can happen
            // before a tab owns the global writer lease; migrating the
            // override here could race a newer locked write.
            pendingStorageWriteErrors.delete(name);
            return fallback === REMOVED_STORAGE_VALUE ? null : fallback;
        }
        try {
            const stored = (await localforage.getItem<string>(name)) || null;
            pendingStorageWriteErrors.delete(name);
            if (stored !== null) return stored;
            // A legacy fallback has no override marker. It is only eligible
            // when IndexedDB has no value at all, never when it contains a
            // potentially newer snapshot.
            if (fallback !== null && fallback !== REMOVED_STORAGE_VALUE) return fallback;
            return null;
        } catch (error) {
            if (VISIONARY_HOSTED && !hasCurrentOverride) throw error;
            return fallback && fallback !== REMOVED_STORAGE_VALUE ? fallback : null;
        }
    },
    setItem: (name, value) =>
        trackStorageWrite(
            name,
            (async () => {
                if (typeof window === "undefined") return;
                try {
                    await localforage.setItem(name, value);
                    window.localStorage.removeItem(storageOverrideKey(name));
                    window.localStorage.removeItem(name);
                } catch {
                    // localStorage is the durable override. If this write also
                    // fails, the exception intentionally propagates so paid
                    // recovery is not acknowledged as persisted.
                    window.localStorage.setItem(name, value);
                    window.localStorage.setItem(storageOverrideKey(name), STORAGE_OVERRIDE_VERSION);
                }
            })(),
        ),
    removeItem: (name) =>
        trackStorageWrite(
            name,
            (async () => {
                if (typeof window === "undefined") return;
                try {
                    await localforage.removeItem(name);
                    window.localStorage.removeItem(storageOverrideKey(name));
                    window.localStorage.removeItem(name);
                } catch {
                    // Preserve deletion across reload even while an old
                    // IndexedDB value cannot be removed.
                    window.localStorage.setItem(name, REMOVED_STORAGE_VALUE);
                    window.localStorage.setItem(storageOverrideKey(name), STORAGE_OVERRIDE_VERSION);
                }
            })(),
        ),
};
