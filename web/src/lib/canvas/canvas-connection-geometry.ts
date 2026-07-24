import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

type ConnectionEndpoint = Pick<CanvasNodeData, "position" | "width" | "height">;

export type CanvasWorldBounds = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

function getConnectionControlPoints(from: ConnectionEndpoint, to: ConnectionEndpoint) {
    const startX = from.position.x + from.width;
    const startY = from.position.y + from.height / 2;
    const endX = to.position.x;
    const endY = to.position.y + to.height / 2;
    const curvature = Math.max(Math.abs(endX - startX) * 0.5, 50);
    const controlStartX = startX + curvature;
    const controlEndX = endX - curvature;

    return { startX, startY, endX, endY, controlStartX, controlEndX };
}

export function getConnectionBounds(from: ConnectionEndpoint, to: ConnectionEndpoint): CanvasWorldBounds {
    const { startX, startY, endX, endY, controlStartX, controlEndX } = getConnectionControlPoints(from, to);
    return {
        left: Math.min(startX, controlStartX, controlEndX, endX),
        top: Math.min(startY, endY),
        right: Math.max(startX, controlStartX, controlEndX, endX),
        bottom: Math.max(startY, endY),
    };
}

export function getConnectionGeometry(from: ConnectionEndpoint, to: ConnectionEndpoint) {
    const { startX, startY, endX, endY, controlStartX, controlEndX } = getConnectionControlPoints(from, to);
    return {
        pathD: `M ${startX} ${startY} C ${controlStartX} ${startY}, ${controlEndX} ${endY}, ${endX} ${endY}`,
    };
}

export function getViewportWorldBounds(viewport: ViewportTransform, viewportSize: { width: number; height: number }, screenPadding = 240): CanvasWorldBounds {
    const scale = Math.max(viewport.k, 0.05);
    const worldPadding = screenPadding / scale;
    return {
        left: -viewport.x / scale - worldPadding,
        top: -viewport.y / scale - worldPadding,
        right: (viewportSize.width - viewport.x) / scale + worldPadding,
        bottom: (viewportSize.height - viewport.y) / scale + worldPadding,
    };
}

export function canvasBoundsIntersect(first: CanvasWorldBounds, second: CanvasWorldBounds) {
    return first.right >= second.left && first.left <= second.right && first.bottom >= second.top && first.top <= second.bottom;
}
