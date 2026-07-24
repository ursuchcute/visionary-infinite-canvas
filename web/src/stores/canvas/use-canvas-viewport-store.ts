import { create } from "zustand";

import type { ViewportTransform } from "@/types/canvas";

type CanvasViewportStore = {
    viewport: ViewportTransform;
    setViewport: (viewport: ViewportTransform) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };

/**
 * 高频视口只负责画布的瞬态视觉状态，不参与项目持久化、历史记录或 Agent 快照。
 */
export const useCanvasViewportStore = create<CanvasViewportStore>((set) => ({
    viewport: initialViewport,
    setViewport: (viewport) =>
        set((state) => {
            const current = state.viewport;
            return current.x === viewport.x && current.y === viewport.y && current.k === viewport.k ? state : { viewport };
        }),
}));
