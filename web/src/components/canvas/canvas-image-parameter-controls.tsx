import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { imageQualityLabel } from "@/components/image-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeMetadata } from "@/types/canvas";

export type CanvasImageResolution = "standard" | "2k" | "4k";

type ImageParameterPanel = "resolution" | "ratio" | "quality" | "count";
type CanvasImageParameterPatch = Pick<CanvasNodeMetadata, "imageResolution" | "imageAspectRatio" | "quality" | "size" | "count">;

type CanvasImageParameterControlsProps = {
    config: AiConfig;
    metadata?: CanvasNodeMetadata;
    hideQuality?: boolean;
    onConfigPatch: (patch: Partial<CanvasImageParameterPatch>) => void;
    onOpenChange?: (open: boolean) => void;
};

const RESOLUTION_OPTIONS: Array<{ value: CanvasImageResolution; label: string }> = [
    { value: "standard", label: "标准" },
    { value: "2k", label: "2K" },
    { value: "4k", label: "4K" },
];

const QUALITY_OPTIONS = [
    { value: "auto", label: "自动" },
    { value: "low", label: "低" },
    { value: "medium", label: "中" },
    { value: "high", label: "高" },
];

export const CANVAS_IMAGE_ASPECT_RATIOS = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21", "2:1", "1:2", "5:4", "4:5", "3:1", "1:3"] as const;

export function CanvasImageParameterControls({ config, metadata, hideQuality = false, onConfigPatch, onOpenChange }: CanvasImageParameterControlsProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const resolutionButtonRef = useRef<HTMLButtonElement>(null);
    const ratioButtonRef = useRef<HTMLButtonElement>(null);
    const qualityButtonRef = useRef<HTMLButtonElement>(null);
    const countButtonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [activePanel, setActivePanel] = useState<ImageParameterPanel | null>(null);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
    const { resolution, ratio } = resolveCanvasImageParameters(metadata);
    const quality = metadata?.quality || "auto";
    const count = normalizeCount(metadata?.count ?? config.count);

    const updatePanel = (panel: ImageParameterPanel | null) => {
        setActivePanel(panel);
        onOpenChange?.(Boolean(panel));
    };

    const buttonRefFor = (panel: ImageParameterPanel) => {
        if (panel === "resolution") return resolutionButtonRef;
        if (panel === "ratio") return ratioButtonRef;
        if (panel === "quality") return qualityButtonRef;
        return countButtonRef;
    };

    useEffect(() => {
        if (hideQuality && activePanel === "quality") updatePanel(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hideQuality]);

    useEffect(() => {
        if (!activePanel) return;
        const activeButtonRef = buttonRefFor(activePanel);
        const syncPosition = () => setButtonRect(activeButtonRef.current?.getBoundingClientRect() || null);
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (activeButtonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setActivePanel(null);
            onOpenChange?.(false);
        };

        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
        };
    }, [activePanel, onOpenChange]);

    const selectResolution = (nextResolution: CanvasImageResolution) => {
        onConfigPatch({ imageResolution: nextResolution, imageAspectRatio: ratio, size: resolveCanvasImageSize(nextResolution, ratio) });
        updatePanel(null);
    };
    const selectRatio = (nextRatio: string) => {
        onConfigPatch({ imageResolution: resolution, imageAspectRatio: nextRatio, size: resolveCanvasImageSize(resolution, nextRatio) });
        updatePanel(null);
    };

    const panel =
        activePanel && buttonRect
            ? createPortal(
                  <ImageParameterPortal
                      activePanel={activePanel}
                      buttonRect={buttonRect}
                      panelRef={panelRef}
                      theme={theme}
                      resolution={resolution}
                      ratio={ratio}
                      quality={quality}
                      count={count}
                      onResolutionSelect={selectResolution}
                      onRatioSelect={selectRatio}
                      onQualitySelect={(value) => {
                          onConfigPatch({ imageResolution: resolution, imageAspectRatio: ratio, quality: value, size: resolveCanvasImageSize(resolution, ratio) });
                          updatePanel(null);
                      }}
                      onCountSelect={(value) => {
                          onConfigPatch({ count: value });
                          updatePanel(null);
                      }}
                  />,
                  document.body,
              )
            : null;

    return (
        <>
            <ParameterTrigger buttonRef={resolutionButtonRef} label="清晰度" value={resolutionLabel(resolution)} active={activePanel === "resolution"} theme={theme} onClick={() => updatePanel(activePanel === "resolution" ? null : "resolution")} />
            <ParameterTrigger buttonRef={ratioButtonRef} label="比例" value={ratioLabel(ratio)} active={activePanel === "ratio"} theme={theme} onClick={() => updatePanel(activePanel === "ratio" ? null : "ratio")} />
            {!hideQuality ? (
                <ParameterTrigger buttonRef={qualityButtonRef} label="质量" value={imageQualityLabel(quality)} active={activePanel === "quality"} theme={theme} onClick={() => updatePanel(activePanel === "quality" ? null : "quality")} />
            ) : null}
            <button
                ref={countButtonRef}
                type="button"
                className="inline-flex h-10 shrink-0 cursor-pointer items-center rounded-lg px-2 text-sm font-medium transition hover:opacity-75"
                style={{ color: theme.node.text, background: activePanel === "count" ? theme.node.fill : "transparent" }}
                title={`生成数量：${count} 张`}
                aria-label="设置图片生成数量"
                aria-expanded={activePanel === "count"}
                onClick={() => updatePanel(activePanel === "count" ? null : "count")}
            >
                {count}×
            </button>
            {panel}
        </>
    );
}

function ParameterTrigger({
    buttonRef,
    label,
    value,
    active,
    theme,
    onClick,
}: {
    buttonRef: RefObject<HTMLButtonElement | null>;
    label: string;
    value: string;
    active: boolean;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onClick: () => void;
}) {
    return (
        <button
            ref={buttonRef}
            type="button"
            className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm transition hover:opacity-75"
            style={{ color: theme.node.text, background: active ? theme.node.fill : "transparent" }}
            title={`${label}：${value}`}
            aria-label={`设置${label}`}
            aria-expanded={active}
            onClick={onClick}
        >
            <span className="text-xs opacity-55">{label}</span>
            <span className="font-medium">{value}</span>
        </button>
    );
}

function ImageParameterPortal({
    activePanel,
    buttonRect,
    panelRef,
    theme,
    resolution,
    ratio,
    quality,
    count,
    onResolutionSelect,
    onRatioSelect,
    onQualitySelect,
    onCountSelect,
}: {
    activePanel: ImageParameterPanel;
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    resolution: CanvasImageResolution;
    ratio: string;
    quality: string;
    count: number;
    onResolutionSelect: (value: CanvasImageResolution) => void;
    onRatioSelect: (value: string) => void;
    onQualitySelect: (value: string) => void;
    onCountSelect: (value: number) => void;
}) {
    const width = activePanel === "ratio" ? 600 : activePanel === "quality" ? 320 : activePanel === "resolution" ? 260 : 236;
    const margin = 12;
    const left = Math.max(margin, Math.min(window.innerWidth - width - margin, buttonRect.left + buttonRect.width / 2 - width / 2));
    const title = activePanel === "resolution" ? "清晰度" : activePanel === "ratio" ? "比例" : activePanel === "quality" ? "质量" : "生成数量";
    const style = {
        position: "fixed",
        zIndex: 1200,
        width: Math.min(width, window.innerWidth - margin * 2),
        left,
        bottom: window.innerHeight - buttonRect.top + 8,
        background: theme.toolbar.panel,
        border: `1px solid ${theme.toolbar.border}`,
        borderRadius: 16,
        boxShadow: "0 18px 54px rgba(0, 0, 0, 0.28)",
        padding: 12,
        color: theme.node.text,
    } as const;

    return (
        <div
            ref={panelRef}
            role="dialog"
            aria-label={`图片${title}`}
            className="animate-in fade-in zoom-in-95 duration-150"
            style={style}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <div className="mb-2 text-xs font-medium" style={{ color: theme.node.muted }}>
                {title}
            </div>
            {activePanel === "resolution" ? (
                <div className="grid grid-cols-3 gap-2">
                    {RESOLUTION_OPTIONS.map((option) => (
                        <ParameterOption key={option.value} active={resolution === option.value} theme={theme} onClick={() => onResolutionSelect(option.value)}>
                            {option.label}
                        </ParameterOption>
                    ))}
                </div>
            ) : activePanel === "ratio" ? (
                <div className="grid grid-cols-8 gap-2">
                    {CANVAS_IMAGE_ASPECT_RATIOS.map((option) => (
                        <ParameterOption key={option} active={ratio === option} theme={theme} onClick={() => onRatioSelect(option)}>
                            {ratioLabel(option)}
                        </ParameterOption>
                    ))}
                </div>
            ) : activePanel === "quality" ? (
                <div className="grid grid-cols-4 gap-2">
                    {QUALITY_OPTIONS.map((option) => (
                        <ParameterOption key={option.value} active={quality === option.value} theme={theme} onClick={() => onQualitySelect(option.value)}>
                            {option.label}
                        </ParameterOption>
                    ))}
                </div>
            ) : activePanel === "count" ? (
                <div className="grid grid-cols-3 gap-1.5">
                    {Array.from({ length: 9 }, (_, index) => index + 1).map((value) => (
                        <ParameterOption key={value} active={count === value} theme={theme} onClick={() => onCountSelect(value)}>
                            {value}×
                        </ParameterOption>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function ParameterOption({ active, theme, onClick, children }: { active: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            className="h-10 cursor-pointer whitespace-nowrap rounded-xl px-2 text-xs font-semibold transition hover:opacity-75"
            style={{
                background: active ? theme.node.text : theme.node.fill,
                color: active ? theme.node.panel : theme.node.text,
                boxShadow: active ? "none" : `inset 0 0 0 1px ${theme.node.stroke}`,
            }}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

export function resolveCanvasImageParameters(metadata?: Pick<CanvasNodeMetadata, "imageResolution" | "imageAspectRatio" | "size">) {
    const explicitResolution = metadata?.imageResolution;
    const resolution: CanvasImageResolution = explicitResolution === "2k" || explicitResolution === "4k" || explicitResolution === "standard" ? explicitResolution : inferResolution(metadata?.size);
    const explicitRatio = metadata?.imageAspectRatio;
    const ratio = explicitRatio && CANVAS_IMAGE_ASPECT_RATIOS.includes(explicitRatio as (typeof CANVAS_IMAGE_ASPECT_RATIOS)[number]) ? explicitRatio : inferRatio(metadata?.size);
    return { resolution, ratio };
}

export function resolveCanvasImageSize(resolution: CanvasImageResolution, ratio: string) {
    if (ratio === "auto") return "auto";
    const [rawWidth, rawHeight] = ratio.split(":").map(Number);
    if (!rawWidth || !rawHeight) return "1:1";
    const landscape = rawWidth >= rawHeight;
    const ratioValue = landscape ? rawWidth / rawHeight : rawHeight / rawWidth;
    let longEdge = resolution === "standard" ? 1024 * ratioValue : resolution === "2k" ? 2048 : 3840;
    let shortEdge = resolution === "standard" ? 1024 : longEdge / ratioValue;
    const maxPixels = 3840 * 2160;
    if (longEdge * shortEdge > maxPixels) {
        const scale = Math.sqrt(maxPixels / (longEdge * shortEdge));
        longEdge *= scale;
        shortEdge *= scale;
    }
    const alignedLong = Math.max(16, Math.floor(longEdge / 16) * 16);
    const alignedShort = Math.max(16, Math.round(shortEdge / 16) * 16);
    return landscape ? `${alignedLong}x${alignedShort}` : `${alignedShort}x${alignedLong}`;
}

function inferResolution(size?: string): CanvasImageResolution {
    const dimensions = size?.match(/^(\d+)x(\d+)$/i);
    if (!dimensions) return "standard";
    const longestEdge = Math.max(Number(dimensions[1]), Number(dimensions[2]));
    if (longestEdge > 2048) return "4k";
    if (longestEdge > 1024) return "2k";
    return "standard";
}

function inferRatio(size?: string) {
    const normalized = size?.trim().toLowerCase();
    if (normalized && CANVAS_IMAGE_ASPECT_RATIOS.includes(normalized as (typeof CANVAS_IMAGE_ASPECT_RATIOS)[number])) return normalized;
    const dimensions = normalized?.match(/^(\d+)x(\d+)$/i);
    if (!dimensions) return "1:1";
    const target = Number(dimensions[1]) / Math.max(1, Number(dimensions[2]));
    return CANVAS_IMAGE_ASPECT_RATIOS.filter((option) => option !== "auto").reduce((best, option) => {
        const [width, height] = option.split(":").map(Number);
        const [bestWidth, bestHeight] = best.split(":").map(Number);
        return Math.abs(width / height - target) < Math.abs(bestWidth / bestHeight - target) ? option : best;
    }, "1:1");
}

function resolutionLabel(value: CanvasImageResolution) {
    return RESOLUTION_OPTIONS.find((option) => option.value === value)?.label || "标准";
}

function ratioLabel(value: string) {
    return value === "auto" ? "Auto" : value;
}

function normalizeCount(value: string | number | undefined) {
    return Math.max(1, Math.min(9, Math.floor(Math.abs(Number(value)) || 1)));
}
