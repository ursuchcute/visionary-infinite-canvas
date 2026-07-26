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

const promptStorage = {
    getItem: (name: string) => localForageStorage.getItem(visionaryHostStorageKey(name)),
    setItem: (name: string, value: string) => localForageStorage.setItem(visionaryHostStorageKey(name), value),
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
            skipHydration: VISIONARY_HOSTED,
            onRehydrateStorage: () => () => usePromptStore.setState({ hydrated: true }),
        },
    ),
);
