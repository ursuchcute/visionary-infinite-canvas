import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Frame, Images, SlidersHorizontal } from "lucide-react";
import { Switch } from "antd";

import { imageAspectOptions, imageQualityLabel, imageQualityOptions, imageSizeLabel } from "@/components/image-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";

type ImageParameterPanel = "display" | "count";

type CanvasImageParameterControlsProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "count", value: string) => void;
    onOpenChange?: (open: boolean) => void;
    advancedOpen?: boolean;
    onAdvancedToggle?: () => void;
};

export function CanvasImageParameterControls({ config, onConfigChange, onOpenChange, advancedOpen = false, onAdvancedToggle }: CanvasImageParameterControlsProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const displayButtonRef = useRef<HTMLButtonElement>(null);
    const countButtonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [activePanel, setActivePanel] = useState<ImageParameterPanel | null>(null);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
    const quality = config.quality || "auto";
    const size = config.size || "auto";
    const count = normalizeCount(config.count);

    const updatePanel = (panel: ImageParameterPanel | null) => {
        setActivePanel(panel);
        onOpenChange?.(Boolean(panel));
    };

    useEffect(() => {
        if (!activePanel) return;
        const activeButtonRef = activePanel === "display" ? displayButtonRef : countButtonRef;
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

    const panel =
        activePanel && buttonRect
            ? createPortal(<ImageParameterPortal activePanel={activePanel} buttonRect={buttonRect} panelRef={panelRef} config={config} theme={theme} onConfigChange={onConfigChange} onCountSelect={() => updatePanel(null)} />, document.body)
            : null;

    return (
        <>
            <button
                ref={displayButtonRef}
                type="button"
                className="inline-flex h-10 max-w-[180px] shrink-0 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm transition hover:opacity-75"
                style={{ color: theme.node.text, background: activePanel === "display" ? theme.node.fill : "transparent" }}
                title={`比例与清晰度：${imageSizeLabel(size)} · ${imageQualityLabel(quality)}`}
                aria-label="设置图片比例与清晰度"
                aria-expanded={activePanel === "display"}
                onClick={() => updatePanel(activePanel === "display" ? null : "display")}
            >
                <Frame className="size-4 shrink-0 opacity-70" />
                <span className="truncate">
                    {imageSizeLabel(size)} · {imageQualityLabel(quality)}
                </span>
            </button>
            <button
                ref={countButtonRef}
                type="button"
                className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm font-medium transition hover:opacity-75"
                style={{ color: theme.node.text, background: activePanel === "count" ? theme.node.fill : "transparent" }}
                title={`生成数量：${count} 张`}
                aria-label="设置图片生成数量"
                aria-expanded={activePanel === "count"}
                onClick={() => updatePanel(activePanel === "count" ? null : "count")}
            >
                <Images className="size-4 opacity-65" />
                {count}×
            </button>
            {onAdvancedToggle ? (
                <button
                    type="button"
                    className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg transition hover:opacity-75"
                    style={{ color: theme.node.text, background: advancedOpen ? theme.node.fill : "transparent" }}
                    title="更多图片参数"
                    aria-label="展开更多图片参数"
                    aria-expanded={advancedOpen}
                    onClick={onAdvancedToggle}
                >
                    <SlidersHorizontal className="size-4 opacity-70" />
                </button>
            ) : null}
            {panel}
        </>
    );
}

export function CanvasImageAdvancedOptions({ config, onConfigChange }: { config: AiConfig; onConfigChange: (key: "size" | "background", value: string) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
    const size = config.size || "auto";
    const dimensions = readSizeDimensions(size);
    const transparentBackground = config.background === "transparent";
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));
        const width = key === "width" ? next : dimensions.width;
        const height = key === "height" ? next : dimensions.height;
        onConfigChange("size", `${alignDimension(width, snapDimensionToStep)}x${alignDimension(height, snapDimensionToStep)}`);
    };

    return (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 rounded-xl px-3 py-2.5" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="min-w-0">
                <div className="mb-1.5 text-[11px] font-medium" style={{ color: theme.node.muted }}>
                    自定义尺寸
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <DimensionInput prefix="W" value={dimensions.width} disabled={size === "auto"} alignToStep={snapDimensionToStep} theme={theme} onChange={(value) => updateDimension("width", value)} />
                    <span className="text-xs opacity-45">×</span>
                    <DimensionInput prefix="H" value={dimensions.height} disabled={size === "auto"} alignToStep={snapDimensionToStep} theme={theme} onChange={(value) => updateDimension("height", value)} />
                </div>
            </div>
            <div className="flex h-14 shrink-0 items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <span className="whitespace-nowrap opacity-65">16 倍数</span>
                    <Switch size="small" checked={snapDimensionToStep} onChange={setSnapDimensionToStep} />
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <span className="whitespace-nowrap opacity-65">透明背景</span>
                    <Switch size="small" checked={transparentBackground} onChange={(checked) => onConfigChange("background", checked ? "transparent" : "")} />
                </label>
            </div>
        </div>
    );
}

function ImageParameterPortal({
    activePanel,
    buttonRect,
    panelRef,
    config,
    theme,
    onConfigChange,
    onCountSelect,
}: {
    activePanel: ImageParameterPanel;
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    config: AiConfig;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onConfigChange: (key: "quality" | "size" | "count", value: string) => void;
    onCountSelect: () => void;
}) {
    const width = activePanel === "display" ? 328 : 236;
    const margin = 12;
    const left = Math.max(margin, Math.min(window.innerWidth - width - margin, buttonRect.left + buttonRect.width / 2 - width / 2));
    const style = {
        position: "fixed",
        zIndex: 1200,
        width,
        left,
        bottom: window.innerHeight - buttonRect.top + 8,
        maxHeight: Math.max(220, buttonRect.top - margin * 2),
        overflowY: "auto",
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
            aria-label={activePanel === "display" ? "图片比例与清晰度" : "图片生成数量"}
            className="thin-scrollbar animate-in fade-in zoom-in-95 duration-150"
            style={style}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            {activePanel === "display" ? <DisplayOptions config={config} theme={theme} onConfigChange={onConfigChange} /> : <CountOptions config={config} theme={theme} onConfigChange={onConfigChange} onSelect={onCountSelect} />}
        </div>
    );
}

function DisplayOptions({ config, theme, onConfigChange }: { config: AiConfig; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onConfigChange: (key: "quality" | "size" | "count", value: string) => void }) {
    const quality = config.quality || "auto";
    const size = config.size || "auto";

    return (
        <div className="space-y-4">
            <ParameterSection title="清晰度" color={theme.node.muted}>
                <div className="grid grid-cols-4 gap-1.5 rounded-xl p-1" style={{ background: theme.node.fill }}>
                    {imageQualityOptions.map((option) => (
                        <ParameterOption key={option.value} active={quality === option.value} theme={theme} onClick={() => onConfigChange("quality", option.value)}>
                            {option.label}
                        </ParameterOption>
                    ))}
                </div>
            </ParameterSection>
            <ParameterSection title="比例" color={theme.node.muted}>
                <div className="grid grid-cols-4 gap-1.5">
                    {imageAspectOptions.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            className="flex h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl text-xs transition hover:opacity-75"
                            style={{
                                background: size === option.value ? theme.node.fill : "transparent",
                                boxShadow: size === option.value ? `inset 0 0 0 1px ${theme.node.text}` : `inset 0 0 0 1px ${theme.node.stroke}`,
                                color: theme.node.text,
                            }}
                            onClick={() => onConfigChange("size", option.value)}
                        >
                            <RatioGlyph label={option.label} color={theme.node.text} />
                            <span className="max-w-full truncate px-1">{option.label.replace(/\(([^)]+)\)/, " $1")}</span>
                        </button>
                    ))}
                </div>
            </ParameterSection>
        </div>
    );
}

function CountOptions({ config, theme, onConfigChange, onSelect }: { config: AiConfig; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onConfigChange: (key: "quality" | "size" | "count", value: string) => void; onSelect: () => void }) {
    const count = normalizeCount(config.count);
    return (
        <ParameterSection title="生成数量" color={theme.node.muted}>
            <div className="grid grid-cols-3 gap-1.5">
                {Array.from({ length: 15 }, (_, index) => index + 1).map((value) => (
                    <ParameterOption
                        key={value}
                        active={count === value}
                        theme={theme}
                        onClick={() => {
                            onConfigChange("count", String(value));
                            onSelect();
                        }}
                    >
                        {value}×
                    </ParameterOption>
                ))}
            </div>
        </ParameterSection>
    );
}

function ParameterSection({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
    return (
        <section>
            <div className="mb-2 text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </section>
    );
}

function ParameterOption({ active, theme, onClick, children }: { active: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            className="h-8 cursor-pointer rounded-lg px-2 text-xs font-medium transition hover:opacity-75"
            style={{
                background: active ? theme.node.text : "transparent",
                color: active ? theme.node.panel : theme.node.text,
                boxShadow: active ? "none" : `inset 0 0 0 1px ${theme.node.stroke}`,
            }}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function RatioGlyph({ label, color }: { label: string; color: string }) {
    const ratioLabel = label.match(/^(\d+):(\d+)/);
    if (!ratioLabel) return <span className="h-4 text-[10px] leading-4 opacity-60">AUTO</span>;
    const width = Number(ratioLabel[1]);
    const height = Number(ratioLabel[2]);
    const ratio = width / Math.max(1, height);
    const glyphWidth = ratio >= 1 ? 18 : Math.max(8, 18 * ratio);
    const glyphHeight = ratio >= 1 ? Math.max(8, 18 / ratio) : 18;
    return <span className="rounded-[2px] border" style={{ width: glyphWidth, height: glyphHeight, borderColor: color }} />;
}

function DimensionInput({
    prefix,
    value,
    disabled,
    alignToStep,
    theme,
    onChange,
}: {
    prefix: string;
    value: number;
    disabled: boolean;
    alignToStep: boolean;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onChange: (value: number | null) => void;
}) {
    const commit = (input: HTMLInputElement) => {
        const next = alignDimension(Math.max(1, Math.floor(Number(input.value) || value || 1024)), alignToStep);
        input.value = String(next);
        onChange(next);
    };

    return (
        <label className="flex h-8 min-w-0 overflow-hidden rounded-lg text-xs" style={{ background: theme.toolbar.panel, color: theme.node.text, opacity: disabled ? 0.5 : 1 }}>
            <span className="grid w-7 shrink-0 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-1.5 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value || ""}
                key={`${prefix}-${value}`}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function readSizeDimensions(size: string) {
    const match = size.match(/^(\d+)x(\d+)$/);
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
    const ratio = imageSizeLabel(size).match(/^(\d+):(\d+)/);
    if (!ratio) return { width: 1024, height: 1024 };
    const widthRatio = Number(ratio[1]);
    const heightRatio = Number(ratio[2]);
    return widthRatio >= heightRatio ? { width: Math.round((1024 * widthRatio) / heightRatio), height: 1024 } : { width: 1024, height: Math.round((1024 * heightRatio) / widthRatio) };
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / 16) * 16 : value;
}

function normalizeCount(value: string | number | undefined) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 1)));
}
