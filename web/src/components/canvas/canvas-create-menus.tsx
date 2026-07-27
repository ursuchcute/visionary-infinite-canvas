import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ImageIcon, List, Music2, Settings2, Video, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type ConnectionHandle, type Position } from "@/types/canvas";
import { VISIONARY_HOSTED } from "@/constant/visionary-hosted";

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

export function ConnectionCreateMenu({
    pending,
    onCreate,
    onClose,
}: {
    pending: PendingConnectionCreate;
    onCreate: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio) => void;
    onClose: () => void;
}) {
    return (
        <CanvasCreateMenuSurface
            position={pending.position}
            title="引用该节点生成"
            dataAttribute="data-connection-create-menu"
            onCreate={onCreate}
            onClose={onClose}
        />
    );
}

export function ConnectionCreateOption({ theme, icon, title, description, badge, disabled = false, onClick }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: React.ReactNode; title: string; description?: string; badge?: string; disabled?: boolean; onClick?: () => void }) {
    return (
        <button
            type="button"
            className={`flex h-16 w-full items-center gap-3 rounded-2xl px-3 text-left transition ${disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer"}`}
            style={{ color: theme.node.text, background: "transparent" }}
            disabled={disabled}
            onClick={onClick}
            onMouseEnter={(event) => {
                if (!disabled) event.currentTarget.style.background = theme.node.fill;
            }}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
        >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: theme.node.fill, color: theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2 text-base font-semibold leading-5">
                    {title}
                    {badge ? <span className="text-[10px] font-medium opacity-60">{badge}</span> : null}
                </span>
                {description ? (
                    <span className="mt-1 block truncate text-sm" style={{ color: theme.node.muted }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </button>
    );
}

export function NodeCreateMenu({ position, onCreate, onClose }: { position: Position; onCreate: (type: string) => void; onClose: () => void }) {
    return (
        <CanvasCreateMenuSurface position={position} title="选择节点" dataAttribute="data-canvas-create-menu" onCreate={onCreate} onClose={onClose} />
    );
}

type CanvasCreateMenuSurfaceProps = {
    position: Position;
    title: string;
    dataAttribute: string;
    onCreate: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio) => void;
    onClose: () => void;
};

/**
 * Both entry points intentionally use one surface so a double-click and a
 * connection drag expose the same node types, spacing and disabled Hosted
 * entries. The title remains contextual because a blank canvas has no source
 * node to reference.
 */
function CanvasCreateMenuSurface({ position, title, dataAttribute, onCreate, onClose }: CanvasCreateMenuSurfaceProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const menuRef = useRef<HTMLDivElement>(null);
    const [clampedPosition, setClampedPosition] = useState(position);

    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [onClose]);

    useLayoutEffect(() => {
        const menu = menuRef.current;
        const parent = menu?.offsetParent as HTMLElement | null;
        if (!menu || !parent) return;
        const updatePosition = () => {
            const padding = 8;
            const next = {
                x: Math.min(Math.max(padding, position.x), Math.max(padding, parent.clientWidth - menu.offsetWidth - padding)),
                y: Math.min(Math.max(padding, position.y), Math.max(padding, parent.clientHeight - menu.offsetHeight - padding)),
            };
            setClampedPosition((current) => (current.x === next.x && current.y === next.y ? current : next));
        };
        updatePosition();
        const observer = new ResizeObserver(updatePosition);
        observer.observe(parent);
        observer.observe(menu);
        return () => observer.disconnect();
    }, [position.x, position.y]);

    return (
        <div
            ref={menuRef}
            className="absolute z-[2000] max-h-[calc(100%-16px)] w-[min(300px,calc(100%-16px))] overflow-y-auto rounded-[18px] border p-3 shadow-2xl backdrop-blur thin-scrollbar"
            data-canvas-no-zoom
            {...{ [dataAttribute]: true }}
            style={{ left: clampedPosition.x, top: clampedPosition.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {title}
                </span>
                <button type="button" className="grid size-8 place-items-center rounded-lg opacity-55 transition hover:bg-white/10 hover:opacity-100" onClick={onClose} aria-label="关闭">
                    <X className="size-5" strokeWidth={2.5} />
                </button>
            </div>
            <div className="grid gap-1">
                <ConnectionCreateOption theme={theme} icon={<List className="size-5" />} title="文本生成" onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title="图片生成" onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption theme={theme} icon={<Video className="size-5" />} title="视频生成" badge={VISIONARY_HOSTED ? "即将上线" : undefined} disabled={VISIONARY_HOSTED} onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption theme={theme} icon={<Music2 className="size-5" />} title={VISIONARY_HOSTED ? "音频生成" : "音频参考"} badge={VISIONARY_HOSTED ? "即将上线" : undefined} disabled={VISIONARY_HOSTED} onClick={() => onCreate(CanvasNodeType.Audio)} />
                {!VISIONARY_HOSTED ? <ConnectionCreateOption theme={theme} icon={<Settings2 className="size-5" />} title="配置节点" onClick={() => onCreate(CanvasNodeType.Config)} /> : null}
            </div>
        </div>
    );
}
