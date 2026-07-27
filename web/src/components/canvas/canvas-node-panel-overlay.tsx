import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useCanvasInteractionStore } from "@/stores/canvas/use-canvas-interaction-store";
import { useCanvasViewportStore } from "@/stores/canvas/use-canvas-viewport-store";
import type { CanvasNodeData } from "@/types/canvas";

export function CanvasNodePanelOverlay({ node, className, children }: { node: CanvasNodeData; className: string; children: ReactNode }) {
    const preview = useCanvasInteractionStore((state) => state.nodePreviews.get(node.id));
    const viewport = useCanvasViewportStore((state) => state.viewport);
    const position = preview?.position || node.position;
    const width = preview?.width ?? node.width;
    const height = preview?.height ?? node.height;
    const panelRef = useRef<HTMLDivElement>(null);
    const desiredLeft = viewport.x + (position.x + width / 2) * viewport.k;
    const desiredTop = viewport.y + (position.y + height) * viewport.k;
    const nodeTop = viewport.y + position.y * viewport.k;
    const [screenPosition, setScreenPosition] = useState({ left: desiredLeft, top: desiredTop });

    useLayoutEffect(() => {
        const panel = panelRef.current;
        const parent = panel?.offsetParent as HTMLElement | null;
        if (!panel || !parent) return;
        const updatePosition = () => {
            const padding = 8;
            const halfWidth = panel.offsetWidth / 2;
            const minLeft = halfWidth + padding;
            const maxLeft = Math.max(minLeft, parent.clientWidth - halfWidth - padding);
            const belowTop = desiredTop;
            const aboveTop = nodeTop - panel.offsetHeight;
            const hasRoomBelow = belowTop + panel.offsetHeight <= parent.clientHeight - padding;
            const preferredTop = hasRoomBelow || aboveTop < padding ? belowTop : aboveTop;
            const next = {
                left: Math.min(Math.max(minLeft, desiredLeft), maxLeft),
                top: Math.min(Math.max(padding, preferredTop), Math.max(padding, parent.clientHeight - panel.offsetHeight - padding)),
            };
            setScreenPosition((current) => (current.left === next.left && current.top === next.top ? current : next));
        };
        updatePosition();
        const observer = new ResizeObserver(updatePosition);
        observer.observe(parent);
        observer.observe(panel);
        return () => observer.disconnect();
    }, [desiredLeft, desiredTop, nodeTop]);

    return (
        <div
            ref={panelRef}
            className={className}
            style={{
                left: screenPosition.left,
                top: screenPosition.top,
                maxWidth: "calc(100% - 16px)",
                maxHeight: "calc(100% - 16px)",
                overflowY: "auto",
            }}
        >
            {children}
        </div>
    );
}
