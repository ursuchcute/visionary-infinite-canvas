import { requestVisionaryHostImage, requestVisionaryHostText } from "@/services/api/visionary-host/client";
import type { VisionaryHostRequestContext } from "@/services/api/visionary-host/contracts";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

export type RequestOptions = {
    signal?: AbortSignal;
    hostContext?: VisionaryHostRequestContext;
};

export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    const response = await requestVisionaryHostImage(requireHostContext(options), prompt, hostImageParameters(config), [], options);
    return response.images.map((image) => ({
        id: image.generationId,
        dataUrl: image.url,
        operationId: response.operationId,
        billing: response.billing,
    }));
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions) {
    if (mask) throw new Error("Hosted 首发暂不支持蒙版编辑。");
    const response = await requestVisionaryHostImage(requireHostContext(options), prompt, hostImageParameters(config), references, options);
    return response.images.map((image) => ({
        id: image.generationId,
        dataUrl: image.url,
        operationId: response.operationId,
        billing: response.billing,
    }));
}

export function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    return requestVisionaryHostText(requireHostContext(options), hostedTextContent(messages), config.model || config.textModel, onDelta, options);
}

function requireHostContext(options?: RequestOptions) {
    if (!options?.hostContext?.clientOperationId || !options.hostContext.projectId || !options.hostContext.nodeId) {
        throw new Error("画布生成上下文缺失，请刷新页面后重试。");
    }
    return options.hostContext;
}

function hostImageParameters(config: AiConfig) {
    return {
        model: config.model || config.imageModel,
        ratio: config.imageAspectRatio || config.size,
        imageSize: config.imageResolution,
        quality: config.quality,
        optimizeChineseText: false,
    };
}

function hostedTextContent(messages: AiTextMessage[]) {
    const parts = messages.flatMap((message) => {
        if (typeof message.content === "string") return message.role === "system" ? [] : [message.content];
        if (message.content.some((item) => item.type === "image_url")) {
            throw new Error("Hosted 文本功能当前只支持纯文本输入。");
        }
        return message.content.filter((item): item is { type: "text"; text: string } => item.type === "text").map((item) => item.text);
    });
    return parts.filter(Boolean).join("\n\n");
}
