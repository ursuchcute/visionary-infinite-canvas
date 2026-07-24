import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type CanvasGraphIndex = {
    nodeById: ReadonlyMap<string, CanvasNodeData>;
    incomingByNodeId: ReadonlyMap<string, readonly CanvasConnection[]>;
    outgoingByNodeId: ReadonlyMap<string, readonly CanvasConnection[]>;
    hiddenBatchNodeIds: ReadonlySet<string>;
};

export function buildCanvasGraphIndex(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasGraphIndex {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const incomingByNodeId = new Map<string, CanvasConnection[]>();
    const outgoingByNodeId = new Map<string, CanvasConnection[]>();

    connections.forEach((connection) => {
        appendConnection(incomingByNodeId, connection.toNodeId, connection);
        appendConnection(outgoingByNodeId, connection.fromNodeId, connection);
    });

    return {
        nodeById,
        incomingByNodeId,
        outgoingByNodeId,
        hiddenBatchNodeIds: buildHiddenBatchNodeIds(nodes, nodeById),
    };
}

export function buildHiddenBatchNodeIds(nodes: CanvasNodeData[], nodeById: ReadonlyMap<string, CanvasNodeData>, collapsingBatchIds?: ReadonlySet<string>) {
    const hiddenNodeIds = new Set<string>();

    nodes.forEach((node) => {
        const rootId = node.metadata?.batchRootId;
        if (!rootId || collapsingBatchIds?.has(rootId)) return;
        const root = nodeById.get(rootId);
        if (root && !root.metadata?.imageBatchExpanded) hiddenNodeIds.add(node.id);
    });

    return hiddenNodeIds;
}

function appendConnection(map: Map<string, CanvasConnection[]>, nodeId: string, connection: CanvasConnection) {
    const existing = map.get(nodeId);
    if (existing) existing.push(connection);
    else map.set(nodeId, [connection]);
}
