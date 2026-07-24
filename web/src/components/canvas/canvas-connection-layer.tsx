import { memo, useMemo, type MouseEvent as ReactMouseEvent } from "react";

import { ActiveConnectionPath, ConnectionPath } from "@/components/canvas/canvas-connections";
import { canvasBoundsIntersect, getConnectionBounds, getViewportWorldBounds } from "@/lib/canvas/canvas-connection-geometry";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position, ViewportTransform } from "@/types/canvas";

type CanvasConnectionLayerProps = {
    connections: CanvasConnection[];
    nodeById: ReadonlyMap<string, CanvasNodeData>;
    hiddenNodeIds: ReadonlySet<string>;
    selectedNodeIds: ReadonlySet<string>;
    selectedConnectionId: string | null;
    activeConnectionIds: ReadonlySet<string>;
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    connectingParams: ConnectionHandle | null;
    mouseWorld: Position;
    connectionTargetNodeId: string | null;
    onSelect: (connectionId: string) => void;
    onContextMenu: (event: ReactMouseEvent<SVGPathElement>, connectionId: string) => void;
};

export const CanvasConnectionLayer = memo(function CanvasConnectionLayer({
    connections,
    nodeById,
    hiddenNodeIds,
    selectedNodeIds,
    selectedConnectionId,
    activeConnectionIds,
    viewport,
    viewportSize,
    connectingParams,
    mouseWorld,
    connectionTargetNodeId,
    onSelect,
    onContextMenu,
}: CanvasConnectionLayerProps) {
    const drawableConnections = useMemo(() => {
        const drawable = [];
        for (const connection of connections) {
            const from = nodeById.get(connection.fromNodeId);
            const to = nodeById.get(connection.toNodeId);
            if (!from || !to || hiddenNodeIds.has(from.id) || hiddenNodeIds.has(to.id)) continue;
            drawable.push({ connection, from, to, bounds: getConnectionBounds(from, to) });
        }
        return drawable;
    }, [connections, hiddenNodeIds, nodeById]);

    const visibleConnections = useMemo(() => {
        const viewportBounds = getViewportWorldBounds(viewport, viewportSize);
        return drawableConnections.filter(({ connection, bounds }) => {
            const forceVisible = connection.id === selectedConnectionId || activeConnectionIds.has(connection.id) || selectedNodeIds.has(connection.fromNodeId) || selectedNodeIds.has(connection.toNodeId);
            return forceVisible || canvasBoundsIntersect(bounds, viewportBounds);
        });
    }, [activeConnectionIds, drawableConnections, selectedConnectionId, selectedNodeIds, viewport, viewportSize]);

    return (
        <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 0 }}>
            {visibleConnections.map(({ connection, from, to }) => (
                <ConnectionPath key={connection.id} connection={connection} from={from} to={to} active={selectedConnectionId === connection.id || activeConnectionIds.has(connection.id)} onSelect={onSelect} onContextMenu={onContextMenu} />
            ))}
            {connectingParams ? <ActiveConnectionPath node={nodeById.get(connectingParams.nodeId)} handle={connectingParams} mouseWorld={mouseWorld} target={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined} /> : null}
        </svg>
    );
});
