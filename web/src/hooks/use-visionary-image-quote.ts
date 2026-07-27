import { useEffect, useState } from "react";

import { VISIONARY_HOSTED } from "@/constant/visionary-hosted";
import { normalizeCanvasImageGenerationCount } from "@/lib/canvas/canvas-generation-limits";
import { createVisionaryOperationContext, quoteVisionaryHostImage } from "@/services/api/visionary-host/client";
import type { AiConfig } from "@/stores/use-config-store";

export function useVisionaryImageQuote(projectId: string, nodeId: string, config: AiConfig, enabled: boolean) {
    const [state, setState] = useState<{ loading: boolean; credits?: number; error?: string }>({ loading: false });

    useEffect(() => {
        if (!VISIONARY_HOSTED || !enabled || !config.model) {
            setState({ loading: false });
            return;
        }
        const controller = new AbortController();
        // Clear the previous parameter set's price immediately so a fast model
        // switch can never display a stale quote during the debounce window.
        setState({ loading: true });
        const timer = window.setTimeout(() => {
            void quoteVisionaryHostImage(
                createVisionaryOperationContext(projectId, nodeId, "quote"),
                {
                    model: config.model,
                    ratio: config.imageAspectRatio || config.size,
                    imageSize: config.imageResolution,
                    quality: config.quality,
                },
                controller.signal,
            )
                .then((quote) => setState({ loading: false, credits: quote.estimatedCredits }))
                .catch((error) => {
                    if (controller.signal.aborted) return;
                    setState({ loading: false, error: error instanceof Error ? error.message : "积分估算失败" });
                });
        }, 350);
        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [config.imageAspectRatio, config.imageResolution, config.model, config.quality, config.size, enabled, nodeId, projectId]);

    const count = normalizeCanvasImageGenerationCount(config.count);
    return state.credits == null ? state : { ...state, credits: state.credits * count };
}
