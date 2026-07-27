import { useEffect, useMemo, useState } from "react";
import { ArrowUp, Image as ImageIcon, LoaderCircle, Square, X } from "lucide-react";
import { Button } from "antd";
import { useParams } from "react-router-dom";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, modelMatchesCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import {
    CanvasImageParameterControls,
    resolveCanvasImageAspectRatios,
    resolveCanvasImageParameters,
    resolveCanvasImageRequestResolution,
    resolveCanvasImageSize,
    shouldHideCanvasImageQuality,
    shouldUseStandardCanvasImageResolution,
} from "./canvas-image-parameter-controls";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "@/components/canvas/canvas-audio-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover } from "@/components/canvas/canvas-video-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { VISIONARY_HOSTED } from "@/constant/visionary-hosted";
import { useVisionaryImageQuote } from "@/hooks/use-visionary-image-quote";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    isConfirming?: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    onReferenceRemove?: (nodeId: string, reference: CanvasResourceReference) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
    modeOverride?: CanvasNodeGenerationMode; // 插件节点用 useBuiltinPanel.mode 指定生成类型
};

export function CanvasNodePromptPanel({ node, isRunning, isConfirming = false, onPromptChange, onConfigChange, onGenerate, onStop, mentionReferences = [], onReferenceRemove, onImageSettingsOpenChange, modeOverride }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = modeOverride ?? defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const modelAvailable = Boolean(config.model);
    const isConfirmingHostedOperation = VISIONARY_HOSTED && !isRunning && (isConfirming || (node.metadata?.status === "loading" && Boolean(node.metadata.hostOperationId)));
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const [prompt, setPrompt] = useState(node.metadata?.prompt || "");
    const projectId = useParams<{ id: string }>().id || "";
    const mentionReferenceSignature = useMemo(() => mentionReferences.map((reference) => `${reference.nodeId}:${reference.label}`).join("|"), [mentionReferences]);
    const attachedImageReferences = useMemo(() => (mode === "image" ? mentionReferences.filter((reference) => reference.kind === "image" && reference.active) : []), [mentionReferences, mode]);
    const quote = useVisionaryImageQuote(projectId, node.id, config, mode === "image" && modelAvailable);

    // 切换节点或连线引用集合变化时恢复父层 prompt；普通输入和生成状态变化不会重建编辑器。
    useEffect(() => {
        setPrompt(node.metadata?.prompt || "");
        onImageSettingsOpenChange?.(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mentionReferenceSignature, node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        onPromptChange(node.id, value);
    };

    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning || isConfirmingHostedOperation || !modelAvailable) return;
        onGenerate(node.id, mode, text);
    };

    if (mode === "text") {
        return (
            <div
                data-text-node-prompt-panel
                className="rounded-[22px] border p-3 shadow-2xl backdrop-blur"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onWheel={(event) => event.stopPropagation()}
            >
                <CanvasPromptLibrary onSelect={updatePrompt} variant="add" />
                <CanvasPromptChipInput
                    value={prompt}
                    references={mentionReferences}
                    onChange={updatePrompt}
                    onSubmit={submit}
                    className="thin-scrollbar mt-1 h-16 w-full cursor-text resize-none px-1 py-2 text-[15px] leading-6 outline-none"
                    style={{ background: "transparent", color: theme.node.text }}
                    placeholder={promptPlaceholder(mode, hasTextContent)}
                />
                <div className="mt-1 flex min-w-0 items-center justify-between gap-3">
                    <ModelPicker
                        config={config}
                        value={config.model}
                        onChange={(model) => onConfigChange(node.id, { model })}
                        capability="text"
                        showIcon={false}
                        onMissingConfig={() => openConfigDialog(true)}
                        className="!h-9 !min-w-0 !max-w-[260px] !border-0 !bg-transparent !px-1 !shadow-none"
                    />
                    <div className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-medium opacity-60">1×</span>
                        <GenerationAction
                            isRunning={isRunning}
                            disabled={!prompt.trim() || !modelAvailable || isConfirmingHostedOperation}
                            theme={theme}
                            creditLabel={VISIONARY_HOSTED ? (isConfirmingHostedOperation ? "确认中" : modelAvailable ? "按量" : "维护中") : "--"}
                            creditTitle={VISIONARY_HOSTED ? (isConfirmingHostedOperation ? "正在确认已提交任务，请勿重复生成" : !modelAvailable ? "文本生成维护中" : undefined) : undefined}
                            onClick={() => (isRunning ? onStop(node.id) : submit())}
                        />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <ImageReferenceAttachments targetNodeId={node.id} references={attachedImageReferences} theme={theme} onRemove={(reference) => onReferenceRemove?.(node.id, reference)} />
            <CanvasPromptChipInput
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                className="thin-scrollbar h-40 w-full cursor-text resize-none rounded-xl px-3 py-2 text-sm leading-5 outline-none"
                style={{ background: "transparent", color: theme.node.text }}
                placeholder={promptPlaceholder(mode, hasTextContent)}
            />

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                    <CanvasPromptLibrary onSelect={updatePrompt} />
                    {mode === "image" ? (
                        <>
                            <ModelPicker
                                config={config}
                                value={config.model}
                                onChange={(model) => onConfigChange(node.id, normalizeCanvasImageModelPatch(globalConfig, node.metadata, model))}
                                capability="image"
                                showIcon={false}
                                onMissingConfig={() => openConfigDialog(true)}
                                className="!h-10 !min-w-[150px] !max-w-[210px] !border-0 !bg-transparent !px-2 !shadow-none"
                            />
                            <PanelDivider color={theme.toolbar.border} />
                            <CanvasImageParameterControls
                                config={config}
                                metadata={node.metadata}
                                hideQuality={shouldHideCanvasImageQuality(config.model, node.metadata)}
                                onConfigPatch={(patch) => onConfigChange(node.id, patch)}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="video" showIcon={false} onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                            <CanvasVideoSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" showIcon={false} onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        </>
                    ) : (
                        <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" showIcon={false} onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                    )}
                </div>
                <GenerationAction
                    isRunning={isRunning}
                    disabled={!prompt.trim() || !modelAvailable || isConfirmingHostedOperation}
                    theme={theme}
                    creditLabel={VISIONARY_HOSTED ? (isConfirmingHostedOperation ? "确认中" : !modelAvailable ? "维护中" : quote.loading ? "…" : quote.credits == null ? "--" : String(quote.credits)) : "--"}
                    creditTitle={
                        VISIONARY_HOSTED
                            ? isConfirmingHostedOperation
                                ? "正在确认已提交任务，请勿重复生成"
                                : !modelAvailable
                                  ? "图片生成维护中"
                                  : quote.error || (quote.credits == null ? "正在估算所需积分" : `预计消耗 ${quote.credits} 积分，服务端结算为准`)
                            : "当前本地生成配置不计算积分"
                    }
                    onClick={() => (isRunning ? onStop(node.id) : submit())}
                />
            </div>
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    const fallbackModel = VISIONARY_HOSTED ? "" : mode === "image" ? defaultConfig.imageModel : mode === "video" ? defaultConfig.videoModel : mode === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    const currentModel = node.metadata?.model;
    const model = currentModel && modelMatchesCapability(globalConfig, currentModel, mode) ? currentModel : defaultModel && modelMatchesCapability(globalConfig, defaultModel, mode) ? defaultModel : fallbackModel;
    const quality = node.metadata?.quality || (mode === "image" ? "auto" : globalConfig.quality || defaultConfig.quality);
    const ratioOptions = mode === "image" ? resolveCanvasImageAspectRatios(globalConfig, model) : [];
    const resolvedImageParameters = mode === "image" ? resolveCanvasImageParameters(node.metadata, ratioOptions) : null;
    const displayedImageResolution = resolvedImageParameters && shouldUseStandardCanvasImageResolution(model) ? "standard" : resolvedImageParameters?.resolution;
    const imageResolution = displayedImageResolution ? resolveCanvasImageRequestResolution(globalConfig, model, displayedImageResolution) : undefined;
    const imageAspectRatio = resolvedImageParameters?.ratio;
    return {
        ...globalConfig,
        model,
        quality: mode === "image" && shouldHideCanvasImageQuality(model, node.metadata) ? "auto" : quality,
        size: mode === "image" && imageResolution && imageAspectRatio ? resolveCanvasImageSize(imageResolution, imageAspectRatio) : node.metadata?.size || (mode === "image" ? "1:1" : globalConfig.size || defaultConfig.size),
        imageResolution: imageResolution || node.metadata?.imageResolution,
        imageAspectRatio: imageAspectRatio || node.metadata?.imageAspectRatio,
        background: node.metadata?.background ?? globalConfig.background ?? defaultConfig.background,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

export function normalizeCanvasImageModelPatch(globalConfig: AiConfig, metadata: CanvasNodeMetadata | undefined, model: string): Partial<CanvasNodeMetadata> {
    const ratioOptions = resolveCanvasImageAspectRatios(globalConfig, model);
    const current = resolveCanvasImageParameters(metadata, ratioOptions);
    const displayedResolution = shouldUseStandardCanvasImageResolution(model) ? "standard" : current.resolution;
    const imageResolution = resolveCanvasImageRequestResolution(globalConfig, model, displayedResolution);
    const imageAspectRatio = current.ratio;
    const nextMetadata: CanvasNodeMetadata = {
        ...metadata,
        model,
        imageResolution,
        imageAspectRatio,
        size: resolveCanvasImageSize(imageResolution, imageAspectRatio),
    };
    return {
        model,
        imageResolution,
        imageAspectRatio,
        size: nextMetadata.size,
        quality: shouldHideCanvasImageQuality(model, nextMetadata) ? "auto" : metadata?.quality || globalConfig.quality || "auto",
    };
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasTextContent: boolean) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "audio") return "描述要生成的音频内容";
    if (mode === "image") return "可按 @ 引用素材，描述任何你想要生成的内容，";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}

function ImageReferenceAttachments({
    targetNodeId,
    references,
    theme,
    onRemove,
}: {
    targetNodeId: string;
    references: CanvasResourceReference[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onRemove: (reference: CanvasResourceReference) => void;
}) {
    if (!references.length) return null;
    return (
        <div data-canvas-image-reference-strip className="mb-2 flex min-h-14 flex-wrap items-center gap-2 px-1">
            {references.map((reference) => (
                <div key={reference.nodeId} className="group relative">
                    {reference.previewUrl ? (
                        <div
                            className="pointer-events-none absolute bottom-[calc(100%+10px)] left-0 z-[1400] w-72 translate-y-1 overflow-hidden rounded-2xl border opacity-0 shadow-2xl transition duration-150 group-hover:translate-y-0 group-hover:opacity-100"
                            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}
                        >
                            <img src={reference.previewUrl} alt="" className="h-44 w-full object-cover" />
                            <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8 text-sm font-semibold text-white">@{reference.title || reference.label}</div>
                        </div>
                    ) : null}
                    <div className="relative grid size-14 place-items-center overflow-hidden rounded-xl border" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                        {reference.previewUrl ? <img src={reference.previewUrl} alt={reference.title} className="h-full w-full object-cover" /> : <ImageIcon className="size-5 opacity-45" />}
                        {reference.nodeId !== targetNodeId ? (
                            <button
                                type="button"
                                className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/75 text-white opacity-0 transition hover:bg-black group-hover:opacity-100"
                                aria-label={`移除参考图 ${reference.title || reference.label}`}
                                title="移除参考图并断开连线"
                                onPointerDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                }}
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onRemove(reference);
                                }}
                            >
                                <X className="size-3.5" />
                            </button>
                        ) : null}
                    </div>
                </div>
            ))}
        </div>
    );
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}

function PanelDivider({ color }: { color: string }) {
    return <span className="h-5 w-px shrink-0" style={{ background: color }} aria-hidden="true" />;
}

function GenerationAction({
    isRunning,
    disabled,
    theme,
    creditLabel,
    creditTitle,
    onClick,
}: {
    isRunning: boolean;
    disabled: boolean;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    creditLabel: string;
    creditTitle?: string;
    onClick: () => void;
}) {
    return (
        <div className="flex h-11 shrink-0 items-center gap-1 rounded-full p-1 pl-2.5" style={{ background: theme.node.fill }} title={creditTitle} aria-label={creditTitle}>
            <img src="/visionary-canvas-logo.png" alt="" className="size-4 rounded-[4px] object-cover" aria-hidden="true" />
            <span className="min-w-5 text-center text-xs font-medium opacity-65">{creditLabel}</span>
            <Button
                className="!size-9 !min-w-9 shrink-0 !rounded-full !border-0 !p-0"
                style={isRunning ? undefined : { background: theme.node.text, color: theme.node.panel }}
                danger={isRunning}
                disabled={!isRunning && disabled}
                onClick={onClick}
                aria-label={isRunning ? "停止生成" : "生成"}
            >
                {isRunning ? (
                    <span className="flex items-center gap-0.5">
                        <LoaderCircle className="size-3.5 animate-spin" />
                        <Square className="size-2.5 fill-current" />
                    </span>
                ) : (
                    <ArrowUp className="size-4" />
                )}
            </Button>
        </div>
    );
}
