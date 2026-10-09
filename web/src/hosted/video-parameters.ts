import { normalizeHostedModel } from "@/constant/visionary-hosted";
import type { VisionaryHostVideoModel } from "@/services/api/visionary-host/contracts";
import type { AiConfig } from "@/stores/use-config-store";

// All selectable capabilities and prices come from the same main-site route.
export function resolveHostedVideoParameters(config: AiConfig, models: VisionaryHostVideoModel[], imageCount = 0) {
    const model = models.find((item) => item.id === normalizeHostedModel(config.model || config.videoModel));
    if (!model) return null;
    const resolutions = model.config.resolutions.filter((value) => !(model.id === "grok-imagine-video-1.5" && imageCount > 0 && value === "1080p"));
    if (!resolutions.length || !model.config.aspectRatios.length) return null;
    const requested = /^\d+$/.test(config.vquality) ? `${config.vquality}p` : config.vquality;
    const resolution = resolutions.includes(requested) ? requested : resolutions[0];
    const ratios = model.config.aspectRatios;
    const ratio = ratios.includes(config.size) ? config.size : ratios[0];
    const maximum = resolution === "1080p" ? Math.min(model.config.durationMax, model.config.max1080Duration) : model.config.durationMax;
    const duration = Math.min(maximum, Math.max(model.config.durationMin, Math.round(Number(config.videoSeconds) || 6)));
    const rule = model.creditRules.find((item) => item.resolution === resolution);
    const credits = rule?.unit === "per_second" && rule.credits != null && Number.isSafeInteger(rule.credits) && rule.credits >= 0 ? rule.credits * duration : null;
    return { model, resolutions, ratios, resolution, ratio, duration, maximum, credits };
}
