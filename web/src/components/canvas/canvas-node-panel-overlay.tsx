import type { ReactNode } from "react";

import { useCanvasInteractionStore } from "@/stores/canvas/use-canvas-interaction-store";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

export function CanvasNodePanelOverlay({ node, viewport, className, children }: { node: CanvasNodeData; viewport: ViewportTransform; className: string; children: ReactNode }) {
    const preview = useCanvasInteractionStore((state) => state.nodePreviews.get(node.id));
    const position = preview?.position || node.position;
    const width = preview?.width ?? node.width;
    const height = preview?.height ?? node.height;

    return (
        <div
            className={className}
            style={{
                left: viewport.x + (position.x + width / 2) * viewport.k,
                top: viewport.y + (position.y + height) * viewport.k,
            }}
        >
            {children}
        </div>
    );
}
