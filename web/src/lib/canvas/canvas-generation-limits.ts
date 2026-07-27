export const MAX_CANVAS_IMAGE_GENERATION_COUNT = 4;

export function normalizeCanvasImageGenerationCount(value: string | number | undefined) {
    return Math.max(1, Math.min(MAX_CANVAS_IMAGE_GENERATION_COUNT, Math.floor(Math.abs(Number(value)) || 1)));
}
