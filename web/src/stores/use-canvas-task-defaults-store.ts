import { create } from "zustand";
import { persist } from "zustand/middleware";

import { CanvasNodeType, type CanvasNodeMetadata, type CanvasNodeTypeId } from "@/types/canvas";

const CANVAS_TASK_DEFAULTS_STORE_KEY = "infinite-canvas:task-defaults";

type ImageTaskDefaults = Pick<CanvasNodeMetadata, "model" | "size" | "imageResolution" | "imageAspectRatio" | "quality" | "background" | "count">;
type TextTaskDefaults = Pick<CanvasNodeMetadata, "model">;

type CanvasTaskDefaultsStore = {
    image: ImageTaskDefaults;
    text: TextTaskDefaults;
    remember: (type: CanvasNodeTypeId, metadata: CanvasNodeMetadata | undefined) => void;
};

function definedMetadata<T extends object>(metadata: T) {
    return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export const useCanvasTaskDefaultsStore = create<CanvasTaskDefaultsStore>()(
    persist(
        (set) => ({
            image: {},
            text: {},
            remember: (type, metadata) => {
                if (type === CanvasNodeType.Text) {
                    set((state) => ({
                        text: {
                            ...state.text,
                            ...definedMetadata({ model: metadata?.model }),
                        },
                    }));
                    return;
                }
                if (type !== CanvasNodeType.Image) return;
                set((state) => ({
                    image: {
                        ...state.image,
                        ...definedMetadata({
                            model: metadata?.model,
                            size: metadata?.size,
                            imageResolution: metadata?.imageResolution,
                            imageAspectRatio: metadata?.imageAspectRatio,
                            quality: metadata?.quality,
                            background: metadata?.background,
                            count: metadata?.count,
                        }),
                    },
                }));
            },
        }),
        {
            name: CANVAS_TASK_DEFAULTS_STORE_KEY,
            partialize: (state) => ({ image: state.image, text: state.text }),
        },
    ),
);

export function getCanvasTaskDefaults(type: CanvasNodeTypeId): CanvasNodeMetadata | undefined {
    const state = useCanvasTaskDefaultsStore.getState();
    if (type === CanvasNodeType.Image) return { ...state.image };
    if (type === CanvasNodeType.Text) return { ...state.text };
    return undefined;
}

export function rememberCanvasTaskDefaults(type: CanvasNodeTypeId, metadata: CanvasNodeMetadata | undefined) {
    useCanvasTaskDefaultsStore.getState().remember(type, metadata);
}
