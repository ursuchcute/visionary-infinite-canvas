import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useCanvasViewportStore } from "@/stores/canvas/use-canvas-viewport-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ViewportTransform } from "@/types/canvas";

const WHEEL_COMMIT_DELAY = 140;

type InfiniteCanvasProps = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    backgroundMode?: CanvasBackgroundMode;
    onViewportChange: (viewport: ViewportTransform) => void;
    onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onCanvasDeselect?: () => void;
    onCanvasDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    children: React.ReactNode;
};

export function InfiniteCanvas({ containerRef, viewport, backgroundMode = "lines", onViewportChange, onCanvasMouseDown, onCanvasDeselect, onCanvasDoubleClick, onContextMenu, onDrop, children }: InfiniteCanvasProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const stageRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const panState = useRef({
        isPanning: false,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        hasMoved: false,
    });
    const frameRef = useRef<number | null>(null);
    const nextViewportRef = useRef<ViewportTransform | null>(null);
    const wheelCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isSpacePressed, setIsSpacePressed] = useState(false);

    const renderViewport = useCallback(
        (next: ViewportTransform) => {
            const stage = stageRef.current;
            if (stage) {
                stage.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.k})`;
                stage.style.setProperty("--canvas-scale", String(next.k));
                stage.style.setProperty("--canvas-inverse-scale", String(1 / Math.max(next.k, 0.05)));
            }

            const root = containerRef.current;
            if (import.meta.env.DEV && root) {
                const serializedViewport = `${next.x.toFixed(2)},${next.y.toFixed(2)},${next.k.toFixed(4)}`;
                if (root.dataset.canvasViewport !== serializedViewport) {
                    root.dataset.canvasViewport = serializedViewport;
                    root.dataset.canvasViewportUpdates = String(Number(root.dataset.canvasViewportUpdates || "0") + 1);
                }
            }

            const grid = gridRef.current;
            if (!grid || backgroundMode === "blank") return;
            const gridSize = 48 * next.k;
            const dotSize = next.k < 0.12 ? 0.8 : 1.15;
            grid.style.backgroundImage =
                backgroundMode === "dots"
                    ? `radial-gradient(circle, ${theme.canvas.dot} ${dotSize}px, transparent ${dotSize + 0.2}px)`
                    : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`;
            grid.style.backgroundSize = `${gridSize}px ${gridSize}px`;
            grid.style.backgroundPosition = `${next.x % gridSize}px ${next.y % gridSize}px`;
        },
        [backgroundMode, containerRef, theme.canvas.dot, theme.canvas.line],
    );

    const applyViewport = useCallback((next: ViewportTransform) => {
        useCanvasViewportStore.getState().setViewport(next);
    }, []);

    const flushViewportFrame = useCallback(() => {
        frameRef.current = null;
        const next = nextViewportRef.current;
        if (!next) return;
        nextViewportRef.current = null;
        applyViewport(next);
    }, [applyViewport]);

    const scheduleViewport = useCallback(
        (next: ViewportTransform) => {
            nextViewportRef.current = next;
            if (frameRef.current !== null) return;
            frameRef.current = requestAnimationFrame(flushViewportFrame);
        },
        [flushViewportFrame],
    );

    const commitViewport = useCallback(
        (next = useCanvasViewportStore.getState().viewport) => {
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
            nextViewportRef.current = null;
            applyViewport(next);
            onViewportChange(next);
        },
        [applyViewport, onViewportChange],
    );

    useLayoutEffect(() => {
        return useCanvasViewportStore.subscribe((state, previous) => {
            if (state.viewport !== previous.viewport) renderViewport(state.viewport);
        });
    }, [renderViewport]);

    useLayoutEffect(() => {
        // 父层只更新裁剪范围时，React 会再次写入持久化 viewport；
        // 在浏览器绘制前恢复瞬态值，避免 10Hz 裁剪更新造成画面回弹。
        renderViewport(useCanvasViewportStore.getState().viewport);
    });

    useEffect(
        () => () => {
            if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
            if (wheelCommitTimerRef.current) clearTimeout(wheelCommitTimerRef.current);
        },
        [],
    );

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code !== "Space") return;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
            setIsSpacePressed(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") setIsSpacePressed(false);
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, []);

    const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;

        const current = nextViewportRef.current || useCanvasViewportStore.getState().viewport;
        const delta = -event.deltaY;
        const factor = Math.pow(1.1, delta / 100);
        const newScale = Math.min(Math.max(current.k * factor, 0.05), 5);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const worldX = (mouseX - current.x) / current.k;
        const worldY = (mouseY - current.y) / current.k;

        const next = {
            x: mouseX - worldX * newScale,
            y: mouseY - worldY * newScale,
            k: newScale,
        };
        scheduleViewport(next);
        if (wheelCommitTimerRef.current) clearTimeout(wheelCommitTimerRef.current);
        wheelCommitTimerRef.current = setTimeout(() => {
            wheelCommitTimerRef.current = null;
            commitViewport(nextViewportRef.current || useCanvasViewportStore.getState().viewport);
        }, WHEEL_COMMIT_DELAY);
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom]")) return;
        if (target?.closest("[data-connection-create-menu]")) return;
        const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id]");

        if (event.button === 0 && (event.ctrlKey || event.metaKey) && isBackgroundClick) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onCanvasMouseDown?.(event);
            return;
        }

        if (event.button === 1 || (event.button === 0 && !isSpacePressed && isBackgroundClick)) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            const current = useCanvasViewportStore.getState().viewport;
            panState.current = {
                isPanning: true,
                startX: event.clientX,
                startY: event.clientY,
                initialX: current.x,
                initialY: current.y,
                hasMoved: false,
            };
            document.body.style.cursor = "grabbing";
            return;
        }

        if (event.button === 0 && isSpacePressed && isBackgroundClick) {
            event.preventDefault();
        }
    };

    const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],[data-node-id],[data-connection-id]")) return;
        onCanvasDoubleClick?.(event);
    };

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            if (!panState.current.isPanning) return;

            const dx = event.clientX - panState.current.startX;
            const dy = event.clientY - panState.current.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                panState.current.hasMoved = true;
            }

            scheduleViewport({
                x: panState.current.initialX + dx,
                y: panState.current.initialY + dy,
                k: useCanvasViewportStore.getState().viewport.k,
            });
        };

        const handlePointerUp = () => {
            if (!panState.current.isPanning) return;

            if (!panState.current.hasMoved) {
                onCanvasDeselect?.();
            } else {
                commitViewport(nextViewportRef.current || useCanvasViewportStore.getState().viewport);
            }
            panState.current.isPanning = false;
            document.body.style.cursor = "";
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
        };
    }, [commitViewport, onCanvasDeselect, scheduleViewport]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // 阻止画布滚动导致页面滚动;但浮层(创建菜单/弹窗等)内允许原生滚动
        const preventWheelScroll = (event: WheelEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;
            event.preventDefault();
        };
        container.addEventListener("wheel", preventWheelScroll, { passive: false });
        return () => container.removeEventListener("wheel", preventWheelScroll);
    }, [containerRef]);

    return (
        <div
            ref={containerRef}
            data-canvas-root=""
            data-canvas-viewport={import.meta.env.DEV ? `${viewport.x.toFixed(2)},${viewport.y.toFixed(2)},${viewport.k.toFixed(4)}` : undefined}
            data-canvas-viewport-updates={import.meta.env.DEV ? "0" : undefined}
            className="relative h-full w-full cursor-grab select-none overflow-hidden"
            style={{ background: theme.canvas.background }}
            onPointerDown={handlePointerDown}
            onDoubleClick={handleDoubleClick}
            onWheel={handleWheel}
            onContextMenu={onContextMenu}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
        >
            <CanvasGrid ref={gridRef} viewport={viewport} mode={backgroundMode} />
            <div
                ref={stageRef}
                className="absolute origin-top-left"
                style={
                    {
                        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
                        "--canvas-scale": viewport.k,
                        "--canvas-inverse-scale": 1 / Math.max(viewport.k, 0.05),
                    } as React.CSSProperties
                }
            >
                {children}
            </div>
        </div>
    );
}

const CanvasGrid = React.forwardRef<HTMLDivElement, { viewport: ViewportTransform; mode: CanvasBackgroundMode }>(function CanvasGrid({ viewport, mode }, ref) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (mode === "blank") return null;

    const gridSize = 48 * viewport.k;
    const x = viewport.x % gridSize;
    const y = viewport.y % gridSize;
    const dotSize = viewport.k < 0.12 ? 0.8 : 1.15;
    const backgroundImage =
        mode === "dots" ? `radial-gradient(circle, ${theme.canvas.dot} ${dotSize}px, transparent ${dotSize + 0.2}px)` : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`;

    return (
        <div
            ref={ref}
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
                backgroundImage,
                backgroundSize: `${gridSize}px ${gridSize}px`,
                backgroundPosition: `${x}px ${y}px`,
            }}
        />
    );
});
