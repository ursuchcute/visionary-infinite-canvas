import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "@/types/canvas";

export type CanvasProjectCoverSource = {
    projectId: string;
    nodeId: string;
    fingerprint: string;
    url: string;
    storageKey?: string;
};

export function getCanvasProjectCoverSource(project: CanvasProject): CanvasProjectCoverSource | null {
    for (let index = project.nodes.length - 1; index >= 0; index -= 1) {
        const node = project.nodes[index];
        if (node.type !== CanvasNodeType.Image) continue;
        const url = node.metadata?.content?.trim() || "";
        const storageKey = node.metadata?.storageKey?.trim() || undefined;
        if (!url && !storageKey) continue;
        const sourceIdentity = storageKey ? `storage:${storageKey}` : `url:${sampledHash(url)}`;
        return {
            projectId: project.id,
            nodeId: node.id,
            fingerprint: `${node.id}:${sourceIdentity}:${node.metadata?.naturalWidth || node.width}x${node.metadata?.naturalHeight || node.height}`,
            url,
            storageKey,
        };
    }
    return null;
}

function sampledHash(value: string) {
    let hash = 2166136261;
    const step = Math.max(1, Math.floor(value.length / 256));
    for (let index = 0; index < value.length; index += step) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${value.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}
