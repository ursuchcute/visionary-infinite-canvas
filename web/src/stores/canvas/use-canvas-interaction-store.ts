import { create } from "zustand";

import type { Position } from "@/types/canvas";

export type CanvasNodePreview = {
    position: Position;
    width: number;
    height: number;
};

type CanvasInteractionStore = {
    nodePreviews: ReadonlyMap<string, CanvasNodePreview>;
    setNodePreviews: (previews: ReadonlyMap<string, CanvasNodePreview>) => void;
    setNodePreview: (nodeId: string, preview: CanvasNodePreview) => void;
    clearNodePreviews: (nodeIds?: Iterable<string>) => void;
};

export const useCanvasInteractionStore = create<CanvasInteractionStore>((set) => ({
    nodePreviews: new Map(),
    setNodePreviews: (previews) => set({ nodePreviews: new Map(previews) }),
    setNodePreview: (nodeId, preview) =>
        set((state) => {
            const next = new Map(state.nodePreviews);
            next.set(nodeId, preview);
            return { nodePreviews: next };
        }),
    clearNodePreviews: (nodeIds) =>
        set((state) => {
            if (!nodeIds) return state.nodePreviews.size ? { nodePreviews: new Map() } : state;
            const next = new Map(state.nodePreviews);
            let changed = false;
            for (const nodeId of nodeIds) changed = next.delete(nodeId) || changed;
            return changed ? { nodePreviews: next } : state;
        }),
}));
