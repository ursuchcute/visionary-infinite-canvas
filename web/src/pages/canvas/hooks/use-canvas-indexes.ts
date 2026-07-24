import { useMemo, useRef } from "react";

import { buildCanvasGraphIndex, buildHiddenBatchNodeIds } from "@/lib/canvas/canvas-graph-index";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export function useCanvasIndexes(nodes: CanvasNodeData[], connections: CanvasConnection[], collapsingBatchIds: ReadonlySet<string>) {
    const graph = useMemo(() => buildCanvasGraphIndex(nodes, connections), [connections, nodes]);
    const resourceNodesRef = useRef<CanvasNodeData[]>([]);

    const resourceNodes = useMemo(() => {
        const previous = resourceNodesRef.current;
        const previousById = new Map(previous.map((node) => [node.id, node]));
        const next = nodes.map((node) => {
            const cached = previousById.get(node.id);
            return cached && sameResourceFields(cached, node) ? cached : node;
        });
        const unchanged = previous.length === next.length && previous.every((node, index) => node === next[index]);
        resourceNodesRef.current = unchanged ? previous : next;
        return resourceNodesRef.current;
    }, [nodes]);

    const resourceGraph = useMemo(() => buildCanvasGraphIndex(resourceNodes, connections), [connections, resourceNodes]);
    const visibleHiddenBatchNodeIds = useMemo(() => buildHiddenBatchNodeIds(nodes, graph.nodeById, collapsingBatchIds), [collapsingBatchIds, graph.nodeById, nodes]);

    return { graph, resourceGraph, resourceNodes, visibleHiddenBatchNodeIds };
}

function sameResourceFields(previous: CanvasNodeData, next: CanvasNodeData) {
    return previous.id === next.id && previous.type === next.type && previous.title === next.title && previous.position === next.position && previous.width === next.width && previous.height === next.height && previous.metadata === next.metadata;
}
