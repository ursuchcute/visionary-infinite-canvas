import { create } from "zustand";

import type { PromptSource } from "@/services/api/prompt-source-presets";

export type PromptSourceSchedule = {
    intervalMinutes: number;
    lastFetchedAt: string;
};

export const PROMPT_SOURCE_INTERVAL_OPTIONS: Array<{ label: string; value: number }> = [];

type HostedPromptSourceState = {
    sources: PromptSource[];
    schedule: PromptSourceSchedule;
    addSource: () => PromptSource;
    saveSource: (_source: PromptSource) => void;
    removeSource: (_id: string) => void;
    toggleSource: (_id: string, _enabled: boolean) => void;
    updateSchedule: <K extends keyof PromptSourceSchedule>(_key: K, _value: PromptSourceSchedule[K]) => void;
};

const disabledSource = (): PromptSource => ({
    id: "hosted-external-sources-disabled",
    name: "Hosted 模式不支持外部来源",
    url: "",
    homepage: "",
    enabled: false,
    builtIn: true,
});

export const usePromptSourceStore = create<HostedPromptSourceState>(() => ({
    sources: [],
    schedule: { intervalMinutes: 0, lastFetchedAt: "" },
    addSource: disabledSource,
    saveSource: () => undefined,
    removeSource: () => undefined,
    toggleSource: () => undefined,
    updateSchedule: () => undefined,
}));
