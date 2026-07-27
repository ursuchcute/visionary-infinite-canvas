import { useMemo } from "react";
import { create } from "zustand";

export type ModelCapability = "image" | "video" | "text" | "audio";
export type ChannelModel = {
    name: string;
    label?: string;
    capability: ModelCapability;
    ratios?: string[];
    imageSizes?: string[];
};
export type ModelChannel = {
    id: string;
    name: string;
    apiFormat: "openai";
    models: ChannelModel[];
};
export type AiConfig = {
    channelMode: "local";
    channels: ModelChannel[];
    models: string[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    quality: string;
    size: string;
    imageResolution?: "standard" | "2k" | "4k";
    imageAspectRatio?: string;
    background: string;
    count: string;
    canvasImageCount: string;
};

export const defaultConfig: AiConfig = {
    channelMode: "local",
    channels: [],
    models: [],
    model: "",
    imageModel: "",
    videoModel: "",
    textModel: "",
    audioModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "false",
    videoWatermark: "false",
    systemPrompt: "",
    quality: "auto",
    size: "1:1",
    imageResolution: "standard",
    imageAspectRatio: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "1",
};

type HostedConfigState = {
    config: AiConfig;
    isConfigOpen: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    isAiConfigReady: (_config: AiConfig, model: string) => boolean;
    openConfigDialog: () => void;
};

export const useConfigStore = create<HostedConfigState>((set) => ({
    config: defaultConfig,
    isConfigOpen: false,
    updateConfig: (key, value) => set((state) => ({ config: { ...state.config, [key]: value } })),
    isAiConfigReady: (_config, model) => Boolean(model.trim()),
    openConfigDialog: () => undefined,
}));

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

const MODEL_SEPARATOR = "::";

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${MODEL_SEPARATOR}${model.trim()}`;
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(MODEL_SEPARATOR);
    return index < 0 ? null : { channelId: value.slice(0, index), model: value.slice(index + MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const model = config.channels.find((channel) => channel.id === decoded.channelId)?.models.find((item) => item.name === decoded.model);
    return model?.label || decoded.model;
}

export function modelOptionRatios(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const modelName = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === modelName));
    return channel?.models.find((model) => model.name === modelName)?.ratios;
}

export function modelOptionImageSizes(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const modelName = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === modelName));
    return channel?.models.find((model) => model.name === modelName)?.imageSizes;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config.channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    const decoded = decodeChannelModel(value);
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === value));
    return channel?.models.some((model) => model.name === (decoded?.model || value) && model.capability === capability) || false;
}
