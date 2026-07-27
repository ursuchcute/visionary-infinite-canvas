import type { VisionaryHostImageRecoveryResult } from "./contracts";
import type { VisionaryHostOperationRecord } from "./operations";

export type HostedOperationNode = {
    id: string;
    metadata?: {
        status?: string;
        hostOperationId?: string;
        batchChildIds?: string[];
        content?: unknown;
    };
};

export type HostedOperationConnection = {
    fromNodeId: string;
    toNodeId: string;
};

export type HostedForegroundRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
};

export const HOST_OPERATION_PENDING_NOT_FOUND_GRACE_MS = 2 * 60_000;
export const HOST_OPERATION_SUBMITTING_NOT_FOUND_GRACE_MS = 24 * 60 * 60_000;

export function isHostAdmissionBlocking(
    record: Pick<VisionaryHostOperationRecord, "nodeId" | "admissionNodeId" | "admissionGroupId" | "status">,
    admissionNodeId: string,
    admissionGroupId: string,
) {
    return (
        (record.admissionNodeId || record.nodeId) === admissionNodeId &&
        record.admissionGroupId !== admissionGroupId &&
        (record.status === "preflight" || record.status === "submitting" || record.status === "pending")
    );
}

export function shouldMarkTextRecoveryClientFailure(admitted: boolean, status: number) {
    return !admitted && status >= 400 && status < 500;
}

export function resolveHostedBatchStatus(children: HostedOperationNode[]): "success" | "loading" | "error" {
    const anySucceeded = children.some((node) => Boolean(node.metadata?.content));
    const anyConfirming = children.some((node) => node.metadata?.status === "loading" && Boolean(node.metadata?.hostOperationId));
    return anySucceeded ? "success" : anyConfirming ? "loading" : "error";
}

export function clearHostedPreflightGuard<T extends HostedOperationNode>(nodes: T[], operationId: string, targetNodeId: string, originNodeId: string): T[] {
    return nodes.map((node) => {
        const isExactTarget = node.id === targetNodeId && (!node.metadata?.hostOperationId || node.metadata.hostOperationId === operationId);
        const isProvisionalOrigin = targetNodeId !== originNodeId && node.id === originNodeId && node.metadata?.status === "loading" && !node.metadata.hostOperationId;
        if (!isExactTarget && !isProvisionalOrigin) return node;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                hostOperationId: undefined,
                status: node.metadata?.content ? "success" : "idle",
                errorDetails: undefined,
            },
        };
    }) as T[];
}

export function recoveryPatch(result: VisionaryHostImageRecoveryResult, record?: VisionaryHostOperationRecord, now = Date.now()): Partial<VisionaryHostOperationRecord> {
    if (result.status === "completed" || result.status === "success") {
        return {
            status: "completed",
            generationId: result.id,
            error: undefined,
            notFoundCount: undefined,
        };
    }
    if (result.status === "not_found") {
        // Preflight records have not crossed the durable admission boundary and
        // are recovered locally by the caller. They must never age into the
        // server not-found failure path.
        if (record?.status === "preflight") {
            return {
                status: "preflight",
                notFoundCount: record.notFoundCount,
            };
        }
        const notFoundCount = (record?.notFoundCount || 0) + 1;
        const preservedStatus = record?.status === "pending" ? "pending" : "submitting";
        // A pending task already has a server generation id and keeps the
        // existing short reconciliation window. A submitting task can have
        // crossed the chargeable admission boundary before the generation row
        // becomes queryable, so keep its duplicate-submit guard for at least a
        // day and require three independent not-found observations.
        const graceMs = preservedStatus === "pending" ? HOST_OPERATION_PENDING_NOT_FOUND_GRACE_MS : HOST_OPERATION_SUBMITTING_NOT_FOUND_GRACE_MS;
        if (!record || now - record.createdAt < graceMs || notFoundCount < 3) {
            return {
                status: preservedStatus,
                notFoundCount,
            };
        }
        return {
            status: "failed",
            error: result.error || "找不到对应的生图任务，原请求未扣除积分。",
            notFoundCount,
        };
    }
    if (result.status === "failed") {
        return {
            status: "failed",
            error: result.error || "图片生成失败。",
            notFoundCount: undefined,
        };
    }
    return { status: "pending", notFoundCount: undefined };
}

export function buildHostedConfirmingNodeIds(nodes: HostedOperationNode[], connections: HostedOperationConnection[]) {
    const pendingTargetIds = new Set(nodes.filter((node) => node.metadata?.status === "loading" && Boolean(node.metadata?.hostOperationId)).map((node) => node.id));
    const pendingResultIds = new Set(pendingTargetIds);
    nodes.forEach((node) => {
        if (node.metadata?.batchChildIds?.some((childId) => pendingTargetIds.has(childId))) pendingResultIds.add(node.id);
    });
    const confirmingNodeIds = new Set(pendingResultIds);
    connections.forEach((connection) => {
        if (pendingResultIds.has(connection.toNodeId)) confirmingNodeIds.add(connection.fromNodeId);
    });
    return confirmingNodeIds;
}

export function buildProtectedHostedNodeIds(nodes: HostedOperationNode[], connections: HostedOperationConnection[], requests: Iterable<HostedForegroundRequest>) {
    const protectedIds = new Set(buildHostedConfirmingNodeIds(nodes, connections));
    for (const request of requests) {
        protectedIds.add(request.targetNodeId);
        protectedIds.add(request.originNodeId);
        protectedIds.add(request.runningNodeId);
    }
    return protectedIds;
}

export function hasHostedOperationConflict(mutationNodeIds: Iterable<string>, nodes: HostedOperationNode[], connections: HostedOperationConnection[], requests: Iterable<HostedForegroundRequest>) {
    const protectedIds = buildProtectedHostedNodeIds(nodes, connections, requests);
    for (const nodeId of mutationNodeIds) {
        if (protectedIds.has(nodeId)) return true;
    }
    return false;
}
