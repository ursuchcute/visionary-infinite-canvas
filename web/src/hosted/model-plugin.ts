import type { ModelCapability } from "@/stores/use-config-store";

export type RunPluginArgs = Record<string, unknown>;
export type PluginVariable = { name: string; type: string; desc: string; capabilities?: ModelCapability[] };
export type PluginTemplate = { label: string; script: string };

export const PLUGIN_VARIABLES: PluginVariable[] = [];
export const PLUGIN_RETURNS: Record<ModelCapability, string> = {
    image: "Hosted 模式不支持自定义模型脚本。",
    video: "Hosted 模式不支持自定义模型脚本。",
    text: "Hosted 模式不支持自定义模型脚本。",
    audio: "Hosted 模式不支持自定义模型脚本。",
};
export const PLUGIN_TEMPLATES: Record<ModelCapability, PluginTemplate[]> = {
    image: [],
    video: [],
    text: [],
    audio: [],
};

export async function runModelPlugin<T = unknown>(_args: RunPluginArgs): Promise<T> {
    throw new Error("Hosted 模式不支持自定义模型脚本。");
}

export function normalizePluginImages(_result: unknown): string[] {
    throw new Error("Hosted 模式不支持自定义模型脚本。");
}
