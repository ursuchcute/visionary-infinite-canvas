import { nanoid } from "nanoid";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { VISIONARY_HOSTED } from "@/constant/visionary-hosted";
import { localForageStorage } from "@/lib/localforage-storage";
import { visionaryHostStorageKey } from "@/services/api/visionary-host/storage-namespace";

export type PersonalPrompt = {
    id: string;
    title: string;
    prompt: string;
    description: string;
    coverUrl: string;
    referenceImageUrls: string[];
    tags: string[];
    createdAt: string;
    updatedAt: string;
    imageMode?: string;
    imageModel?: string;
    imageSize?: string;
    imageCount?: number;
};

export type PersonalPromptInput = Omit<PersonalPrompt, "id" | "createdAt" | "updatedAt">;

type QueuedPromptPersist = {
    name: string;
    value: string;
};
let persistedPromptSnapshot: string | null = null;
let queuedPromptPersist: QueuedPromptPersist | null = null;
let activePromptPersist: QueuedPromptPersist | null = null;
let activePromptPersistWrite: Promise<void> | null = null;

function startPromptStorePersistWrite() {
    if (activePromptPersistWrite) return activePromptPersistWrite;
    const queued = queuedPromptPersist;
    if (!queued) return Promise.resolve();
    queuedPromptPersist = null;
    activePromptPersist = queued;
    activePromptPersistWrite = (async () => {
        try {
            await localForageStorage.setItem(visionaryHostStorageKey(queued.name), queued.value);
            persistedPromptSnapshot = queued.value;
        } catch (error) {
            // Preserve the newest unsaved value. If another update arrived while
            // this write was active, that newer queued value supersedes it.
            if (!queuedPromptPersist) queuedPromptPersist = queued;
            throw error;
        } finally {
            activePromptPersist = null;
            activePromptPersistWrite = null;
        }
    })();
    return activePromptPersistWrite;
}

export async function flushPromptStorePersistence() {
    while (true) {
        const write = activePromptPersistWrite || (queuedPromptPersist ? startPromptStorePersistWrite() : null);
        if (!write) return;
        await write;
    }
}

export async function reloadPromptStoreFromPersistence() {
    if (activePromptPersistWrite) {
        try {
            await activePromptPersistWrite;
        } catch {
            // The authoritative reload below replaces the failed local value.
        }
    }
    queuedPromptPersist = null;
    persistedPromptSnapshot = null;
    await usePromptStore.persist.rehydrate();
}

const promptStorage = {
    getItem: async (name: string) => {
        const value = await localForageStorage.getItem(visionaryHostStorageKey(name));
        persistedPromptSnapshot = value;
        return value;
    },
    setItem: (name: string, value: string) => {
        if (persistedPromptSnapshot === value && !activePromptPersistWrite && !queuedPromptPersist) return;
        if (activePromptPersist?.value === value && !queuedPromptPersist) return;
        queuedPromptPersist = { name, value };
        // Zustand callers are synchronous and do not observe a returned
        // rejection. The explicit Hosted flush API owns error reporting/retry.
        void flushPromptStorePersistence().catch(() => undefined);
    },
    removeItem: (name: string) => localForageStorage.removeItem(visionaryHostStorageKey(name)),
};

type PromptStore = {
    hydrated: boolean;
    prompts: PersonalPrompt[];
    addPrompt: (prompt: PersonalPromptInput) => string;
    updatePrompt: (id: string, prompt: PersonalPromptInput) => void;
    removePrompt: (id: string) => void;
};

export const usePromptStore = create<PromptStore>()(
    persist(
        (set) => ({
            hydrated: false,
            prompts: [],
            addPrompt: (prompt) => {
                const id = nanoid();
                const now = new Date().toISOString();
                set((state) => ({ prompts: [{ ...prompt, id, createdAt: now, updatedAt: now }, ...state.prompts] }));
                return id;
            },
            updatePrompt: (id, prompt) => set((state) => ({ prompts: state.prompts.map((item) => (item.id === id ? { ...item, ...prompt, updatedAt: new Date().toISOString() } : item)) })),
            removePrompt: (id) => set((state) => ({ prompts: state.prompts.filter((item) => item.id !== id) })),
        }),
        {
            name: "infinite-canvas:prompt_store",
            storage: createJSONStorage(() => promptStorage),
            partialize: (state) => ({ prompts: state.prompts }) as PromptStore,
            skipHydration: VISIONARY_HOSTED,
            onRehydrateStorage: () => () => usePromptStore.setState({ hydrated: true }),
        },
    ),
);
