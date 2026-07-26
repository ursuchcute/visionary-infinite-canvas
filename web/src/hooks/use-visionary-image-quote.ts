import { useEffect, useState } from "react";

import { VISIONARY_HOSTED } from "@/constant/visionary-hosted";
import { createVisionaryOperationContext, quoteVisionaryHostImage } from "@/services/api/visionary-host/client";
import type { AiConfig } from "@/stores/use-config-store";

export function useVisionaryImageQuote(projectId: string, nodeId: string, prompt: string, config: AiConfig, enabled: boolean) {
    const [state, setState] = useState<{ loading: boolean; credits?: number; error?: string }>({ loading: false });

    useEffect(() => {
        if (!VISIONARY_HOSTED || !enabled || !prompt.trim() || !config.model) {
            setState({ loading: false });
            return;
        }
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            setState({ loading: true });
            void quoteVisionaryHostImage(
                createVisionaryOperationContext(projectId, nodeId, "quote"),
                prompt,
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
    }, [config.imageAspectRatio, config.imageResolution, config.model, config.quality, config.size, enabled, nodeId, projectId, prompt]);

    return state;
}
