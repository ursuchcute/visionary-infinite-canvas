import { useCallback, useMemo, useRef, useState } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import { useCanvasInteractionStore } from "@/stores/canvas/use-canvas-interaction-store";
import { useCanvasViewportStore } from "@/stores/canvas/use-canvas-viewport-store";
import { type CanvasNodeData, type ViewportTransform } from "@/types/canvas";

const VIEWPORT_PREVIEW_INTERVAL = 100;

export function Minimap({
    nodes,
    viewportSize,
    onViewportPreview,
    onViewportChange,
}: {
    nodes: CanvasNodeData[];
    viewportSize: { width: number; height: number };
    onViewportPreview?: (viewport: ViewportTransform) => void;
    onViewportChange: (viewport: ViewportTransform) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const containerRef = useRef<HTMLDivElement>(null);
    const lastPreviewAtRef = useRef(0);
    const [isDragging, setIsDragging] = useState(false);
    const nodePreviews = useCanvasInteractionStore((state) => state.nodePreviews);
    const width = 240;
    const height = 160;

    const { worldBounds, scale, offset } = useMemo(() => {
        if (!nodes.length) {
            return { worldBounds: { x: -500, y: -500, w: 1000, h: 1000 }, scale: 0.16, offset: { x: 40, y: 0 } };
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        nodes.forEach((node) => {
            const preview = nodePreviews.get(node.id);
            const position = preview?.position || node.position;
            const nodeWidth = preview?.width ?? node.width;
            const nodeHeight = preview?.height ?? node.height;
            minX = Math.min(minX, position.x);
            minY = Math.min(minY, position.y);
            maxX = Math.max(maxX, position.x + nodeWidth);
            maxY = Math.max(maxY, position.y + nodeHeight);
        });

        minX -= 500;
        minY -= 500;
        maxX += 500;
        maxY += 500;

        const boundsWidth = maxX - minX;
        const boundsHeight = maxY - minY;
        const nextScale = Math.min(width / boundsWidth, height / boundsHeight);
        const mapContentW = boundsWidth * nextScale;
        const mapContentH = boundsHeight * nextScale;

        return {
            worldBounds: { x: minX, y: minY, w: boundsWidth, h: boundsHeight },
            scale: nextScale,
            offset: { x: (width - mapContentW) / 2, y: (height - mapContentH) / 2 },
        };
    }, [nodePreviews, nodes]);

    const toMinimap = useCallback(
        (worldX: number, worldY: number) => {
            return {
                x: (worldX - worldBounds.x) * scale + offset.x,
                y: (worldY - worldBounds.y) * scale + offset.y,
            };
        },
        [offset.x, offset.y, scale, worldBounds.x, worldBounds.y],
    );

    const toWorld = useCallback(
        (minimapX: number, minimapY: number) => {
            return {
                x: (minimapX - offset.x) / scale + worldBounds.x,
                y: (minimapY - offset.y) / scale + worldBounds.y,
            };
        },
        [offset.x, offset.y, scale, worldBounds.x, worldBounds.y],
    );

    const updateViewportFromEvent = (event: React.PointerEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const viewport = useCanvasViewportStore.getState().viewport;
        const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);
        const next = {
            x: viewportSize.width / 2 - world.x * viewport.k,
            y: viewportSize.height / 2 - world.y * viewport.k,
            k: viewport.k,
        };
        useCanvasViewportStore.getState().setViewport(next);
        const now = performance.now();
        if (now - lastPreviewAtRef.current >= VIEWPORT_PREVIEW_INTERVAL) {
            lastPreviewAtRef.current = now;
            onViewportPreview?.(next);
        }
    };

    const commitViewport = () => {
        const next = useCanvasViewportStore.getState().viewport;
        onViewportPreview?.(next);
        onViewportChange(next);
        setIsDragging(false);
    };

    return (
        <div className="absolute bottom-24 left-6 z-50 overflow-hidden rounded-lg border shadow-2xl backdrop-blur-sm" style={{ width, height, background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
            <div
                ref={containerRef}
                className="relative h-full w-full cursor-crosshair"
                onPointerDown={(event) => {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setIsDragging(true);
                    updateViewportFromEvent(event);
                }}
                onPointerMove={(event) => {
                    if (isDragging) updateViewportFromEvent(event);
                }}
                onPointerUp={commitViewport}
                onPointerLeave={() => {
                    if (isDragging) commitViewport();
                }}
            >
                {nodes.map((node) => {
                    const preview = nodePreviews.get(node.id);
                    const position = preview?.position || node.position;
                    const nodeWidth = preview?.width ?? node.width;
                    const nodeHeight = preview?.height ?? node.height;
                    const pos = toMinimap(position.x, position.y);
                    const color = getNodeDefinition(node.type)?.minimapColor || theme.node.muted;
                    return (
                        <div
                            key={node.id}
                            className="absolute rounded-[1px]"
                            style={{
                                left: pos.x,
                                top: pos.y,
                                width: Math.max(nodeWidth * scale, 2),
                                height: Math.max(nodeHeight * scale, 2),
                                backgroundColor: color,
                                opacity: 0.8,
                            }}
                        />
                    );
                })}
                <MinimapViewportRect toMinimap={toMinimap} viewportSize={viewportSize} borderColor={theme.node.activeStroke} />
            </div>
        </div>
    );
}

function MinimapViewportRect({ toMinimap, viewportSize, borderColor }: { toMinimap: (worldX: number, worldY: number) => { x: number; y: number }; viewportSize: { width: number; height: number }; borderColor: string }) {
    const viewport = useCanvasViewportStore((state) => state.viewport);
    const viewportRect = useMemo(() => {
        const vx = -viewport.x / viewport.k;
        const vy = -viewport.y / viewport.k;
        const vw = viewportSize.width / viewport.k;
        const vh = viewportSize.height / viewport.k;
        const p1 = toMinimap(vx, vy);
        const p2 = toMinimap(vx + vw, vy + vh);

        return {
            x: p1.x,
            y: p1.y,
            w: Math.max(p2.x - p1.x, 4),
            h: Math.max(p2.y - p1.y, 4),
        };
    }, [toMinimap, viewport.k, viewport.x, viewport.y, viewportSize.height, viewportSize.width]);

    return <div className="pointer-events-none absolute border" style={{ left: viewportRect.x, top: viewportRect.y, width: viewportRect.w, height: viewportRect.h, borderColor, background: `${borderColor}18` }} />;
}
