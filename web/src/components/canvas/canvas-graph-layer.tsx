import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useCanvasViewportStore } from "@/stores/canvas/use-canvas-viewport-store";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

const CULLING_VIEWPORT_INTERVAL = 100;

type CanvasGraphLayerProps = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    nodeById: ReadonlyMap<string, CanvasNodeData>;
    hiddenNodeIds: ReadonlySet<string>;
    selectedNodeIds: ReadonlySet<string>;
    selectedConnectionId: string | null;
    activeConnectionIds: ReadonlySet<string>;
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    renderConnections: (viewport: ViewportTransform) => ReactNode;
    renderNode: (node: CanvasNodeData) => ReactNode;
};

function isSameViewport(current: ViewportTransform, next: ViewportTransform) {
    return current.x === next.x && current.y === next.y && current.k === next.k;
}

/**
 * Owns the throttled viewport used for graph culling so transient pan/zoom updates
 * only reconcile the graph subtree, never the full project page.
 */
export function CanvasGraphLayer({ nodes, hiddenNodeIds, viewport, renderConnections, renderNode }: CanvasGraphLayerProps) {
    const [cullingViewport, setCullingViewport] = useState(viewport);
    const pendingViewportRef = useRef<ViewportTransform | null>(null);
    const lastCullingCommitAtRef = useRef(0);
    const cullingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useLayoutEffect(() => {
        const flushPendingViewport = () => {
            cullingTimerRef.current = null;
            const next = pendingViewportRef.current;
            pendingViewportRef.current = null;
            if (!next) return;
            lastCullingCommitAtRef.current = performance.now();
            setCullingViewport((current) => (isSameViewport(current, next) ? current : next));
        };

        const queueViewport = (next: ViewportTransform) => {
            pendingViewportRef.current = next;
            const elapsed = performance.now() - lastCullingCommitAtRef.current;
            if (elapsed >= CULLING_VIEWPORT_INTERVAL) {
                if (cullingTimerRef.current) clearTimeout(cullingTimerRef.current);
                flushPendingViewport();
                return;
            }
            if (cullingTimerRef.current) return;
            cullingTimerRef.current = setTimeout(flushPendingViewport, CULLING_VIEWPORT_INTERVAL - elapsed);
        };

        const unsubscribe = useCanvasViewportStore.subscribe((state) => queueViewport(state.viewport));
        queueViewport(useCanvasViewportStore.getState().viewport);

        return () => {
            unsubscribe();
            if (cullingTimerRef.current) clearTimeout(cullingTimerRef.current);
            cullingTimerRef.current = null;
            pendingViewportRef.current = null;
        };
    }, []);

    useLayoutEffect(() => {
        if (cullingTimerRef.current) clearTimeout(cullingTimerRef.current);
        cullingTimerRef.current = null;
        pendingViewportRef.current = null;
        lastCullingCommitAtRef.current = performance.now();
        setCullingViewport((current) => (isSameViewport(current, viewport) ? current : viewport));
    }, [viewport]);

    useLayoutEffect(() => {
        if (!import.meta.env.DEV || typeof window === "undefined") return;
        const benchmarkWindow = window as Window & { __VCANVAS_BENCHMARK__?: { active: boolean; graphCommits: number } };
        if (benchmarkWindow.__VCANVAS_BENCHMARK__?.active) benchmarkWindow.__VCANVAS_BENCHMARK__.graphCommits += 1;
    });

    // Viewport movement must never change whether a node is mounted. Only
    // product-level batch folding may intentionally hide child nodes.
    const mountedNodes = useMemo(() => nodes.filter((node) => !hiddenNodeIds.has(node.id)), [hiddenNodeIds, nodes]);

    return (
        <>
            {renderConnections(cullingViewport)}
            {mountedNodes.map(renderNode)}
        </>
    );
}
