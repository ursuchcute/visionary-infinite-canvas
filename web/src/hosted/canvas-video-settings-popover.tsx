import { useState } from "react";
import { createPortal } from "react-dom";
import { resolveHostedVideoParameters } from "./video-parameters";
import { useVisionaryHostStore } from "@/stores/use-visionary-host-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { canvasThemes } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";

export type CanvasVideoSettingKey = keyof AiConfig;
export function CanvasVideoSettingsPopover({
    config,
    onConfigChange,
    imageCount = 0,
    buttonClassName = "",
}: {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    buttonClassName?: string;
    placement?: string;
    imageCount?: number;
}) {
    const models = useVisionaryHostStore((state) => state.bootstrap?.video?.models);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const params = resolveHostedVideoParameters(config, models || [], imageCount);
    const [position, setPosition] = useState<{ left: number; bottom?: number; top?: number } | null>(null);
    if (!params) return null;
    return (
        <>
            <button
                type="button"
                aria-expanded={Boolean(position)}
                className={`h-10 shrink-0 cursor-pointer rounded px-2 text-sm hover:bg-black/5 dark:hover:bg-white/10 ${buttonClassName}`}
                style={{ color: theme.node.text }}
                onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setPosition(
                        position
                            ? null
                            : {
                                  left: Math.max(12, Math.min(window.innerWidth - 272, rect.left)),
                                  ...(rect.top >= 280 ? { bottom: Math.max(12, window.innerHeight - rect.top + 8) } : { top: Math.max(12, Math.min(window.innerHeight - 280, rect.bottom + 8)) }),
                              },
                    );
                }}
            >
                {params.resolution} · {params.ratio} · {params.duration} 秒
            </button>
            {position &&
                createPortal(
                    <div
                        data-canvas-no-zoom
                        onWheel={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") setPosition(null);
                        }}
                        className="fixed inset-0 z-[1300]"
                        onPointerDown={() => setPosition(null)}
                    >
                        <div
                            className="absolute w-[260px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] overflow-y-auto space-y-3 rounded-xl p-4"
                            style={{ ...position, background: theme.toolbar.panel, color: theme.node.text }}
                            onPointerDown={(event) => event.stopPropagation()}
                        >
                            <div className="flex items-center justify-between">
                                <span>视频参数</span>
                                <button type="button" onClick={() => setPosition(null)} aria-label="关闭视频参数">
                                    关闭
                                </button>
                            </div>
                            <label className="flex justify-between gap-3">
                                清晰度
                                <select aria-label="视频清晰度" value={params.resolution} onChange={(event) => onConfigChange("vquality", event.target.value)} style={{ background: theme.toolbar.panel }}>
                                    {params.resolutions.map((value) => (
                                        <option key={value}>{value}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex justify-between gap-3">
                                比例
                                <select aria-label="视频比例" value={params.ratio} onChange={(event) => onConfigChange("size", event.target.value)} style={{ background: theme.toolbar.panel }}>
                                    {params.ratios.map((value) => (
                                        <option key={value}>{value}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex justify-between gap-3">
                                时长
                                <select aria-label="视频时长" value={params.duration} onChange={(event) => onConfigChange("videoSeconds", event.target.value)} style={{ background: theme.toolbar.panel }}>
                                    {Array.from({ length: params.maximum - params.model.config.durationMin + 1 }, (_, index) => params.model.config.durationMin + index).map((value) => (
                                        <option key={value} value={value}>
                                            {value} 秒
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <p className="text-xs opacity-70">支持文字和连接的参考图片。{params.model.id === "grok-imagine-video-1.5" && imageCount > 0 ? "参考图最高为 720p。" : ""}</p>
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
}
