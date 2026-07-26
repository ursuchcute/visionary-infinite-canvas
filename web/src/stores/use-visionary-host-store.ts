import { create } from "zustand";

import { defaultConfig, encodeChannelModel, useConfigStore, type ChannelModel, type ModelChannel } from "@/stores/use-config-store";
import type { VisionaryHostBilling, VisionaryHostBootstrap } from "@/services/api/visionary-host/contracts";
import { startVisionaryHostSession } from "@/services/api/visionary-host/session";
import { setVisionaryHostStorageNamespace } from "@/services/api/visionary-host/storage-namespace";

type VisionaryHostState = {
    status: "idle" | "connecting" | "ready" | "unavailable";
    bootstrap: VisionaryHostBootstrap | null;
    error: string;
    initialize: () => Promise<void>;
    updateCredits: (credits: number) => void;
    applyBilling: (billing: VisionaryHostBilling) => void;
};

let initialization: Promise<void> | null = null;

export const useVisionaryHostStore = create<VisionaryHostState>((set, get) => ({
    status: "idle",
    bootstrap: null,
    error: "",
    initialize: async () => {
        if (get().status === "ready" || initialization) return initialization || Promise.resolve();
        set({ status: "connecting", error: "" });
        initialization = startVisionaryHostSession({
            onBootstrap: async (bootstrap) => {
                if (bootstrap.protocolVersion !== 1) throw new Error("画布服务协议版本不兼容，请刷新主站后重试。");
                const shouldHydrate = setVisionaryHostStorageNamespace(bootstrap.storageNamespace);
                applyBootstrapConfig(bootstrap);
                if (shouldHydrate) await hydrateHostedUserStorage();
                set({ status: "ready", bootstrap, error: "" });
            },
            onCredits: (credits) => get().updateCredits(credits),
            onInvalid: (error) => set({ status: "unavailable", error }),
        })
            .then(() => undefined)
            .catch((error) => {
                set({
                    status: "unavailable",
                    error: error instanceof Error ? error.message : "画布功能暂时不可用，请从主站重新打开。",
                });
            })
            .finally(() => {
                initialization = null;
            });
        return initialization;
    },
    updateCredits: (credits) =>
        set((state) => ({
            bootstrap: state.bootstrap
                ? {
                      ...state.bootstrap,
                      user: { ...state.bootstrap.user, credits },
                  }
                : null,
        })),
    applyBilling: (billing) => {
        const credits = Number(billing.remainingCredits);
        if (Number.isFinite(credits)) get().updateCredits(credits);
    },
}));

function applyBootstrapConfig(bootstrap: VisionaryHostBootstrap) {
    const imageModels = bootstrap.features.image ? bootstrap.image.models : [];
    const textModels = bootstrap.features.text ? bootstrap.text.models : [];
    const models: ChannelModel[] = [...imageModels.map((model) => ({ name: model.id, capability: "image" as const })), ...textModels.map((model) => ({ name: model.key, capability: "text" as const }))];
    const channel = {
        id: "visionary-host",
        name: "Visionary",
        apiFormat: "openai",
        models,
    } as ModelChannel;
    const defaultImageModel = imageModels.find((model) => model.id === bootstrap.image.defaultModel)?.id || imageModels[0]?.id || "";
    const defaultTextModel = textModels.find((model) => model.key === bootstrap.text.defaultModel)?.key || textModels[0]?.key || "";
    const imageModel = defaultImageModel ? encodeChannelModel(channel.id, defaultImageModel) : "";
    const textModel = defaultTextModel ? encodeChannelModel(channel.id, defaultTextModel) : "";
    const imageSize = normalizeBootstrapImageSize(bootstrap.image.defaults?.imageSize);
    const ratio = bootstrap.image.defaults?.ratio || "1:1";
    useConfigStore.setState((state) => ({
        ...state,
        config: {
            ...defaultConfig,
            channelMode: "local",
            channels: [channel],
            models: models.map((model) => encodeChannelModel(channel.id, model.name)),
            model: imageModel,
            imageModel,
            textModel,
            videoModel: "",
            audioModel: "",
            count: "1",
            canvasImageCount: "1",
            size: ratio,
            imageAspectRatio: ratio,
            imageResolution: imageSize,
            quality: bootstrap.image.defaults?.quality || "auto",
            systemPrompt: "",
        },
        isConfigOpen: false,
    }));
}

function normalizeBootstrapImageSize(value?: string) {
    const normalized = (value || "1K").trim().toUpperCase();
    if (normalized === "2K") return "2k" as const;
    if (normalized === "4K") return "4k" as const;
    return "standard" as const;
}

async function hydrateHostedUserStorage() {
    const [{ useCanvasStore }, { useAssetStore }, { usePromptStore }] = await Promise.all([import("@/stores/canvas/use-canvas-store"), import("@/stores/use-asset-store"), import("@/stores/use-prompt-store")]);
    await Promise.all([useCanvasStore.persist.rehydrate(), useAssetStore.persist.rehydrate(), usePromptStore.persist.rehydrate()]);
}
