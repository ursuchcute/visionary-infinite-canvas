import type { VisionaryHostOperationPendingError } from "./client";
import type { HostedOperationNode } from "./operation-state";

export function hostedPendingImageMetadata(error: VisionaryHostOperationPendingError) {
    const deliveryPending = "deliveryPending" in error && error.deliveryPending === true;
    return {
        status: deliveryPending ? ("error" as const) : ("loading" as const),
        hostImageDeliveryStatus: deliveryPending ? ("failed" as const) : undefined,
        errorDetails: error.message,
        hostOperationId: error.operationId,
    };
}

export function markImageAwaitingDelivery<T extends HostedOperationNode>(nodes: T[], nodeId: string, operationId: string): T[] {
    return nodes.map((node) => {
        if (node.id !== nodeId || (node.metadata?.hostOperationId && node.metadata.hostOperationId !== operationId)) return node;
        if (node.metadata?.content && node.metadata.hostOperationId !== operationId) return node;
        if (node.metadata?.content) return node.metadata.status === "loading" ? { ...node, metadata: { ...node.metadata, status: "success", hostImageDeliveryStatus: undefined, errorDetails: undefined } } : node;
        if (node.metadata?.hostImageDeliveryStatus) return node;
        return { ...node, metadata: { ...node.metadata, hostOperationId: operationId, status: "error", hostImageDeliveryStatus: "pending", errorDetails: "图片已生成，正在领取原图，不会再次扣分。" } };
    }) as T[];
}

export function markImagesAwaitingDelivery<T extends HostedOperationNode>(nodes: T[], records: { nodeId: string; clientOperationId: string }[]): T[] {
    if (!records.length) return nodes;
    const latest = new Map(records.map((record) => [record.nodeId, record]));
    const next = nodes.map((node) => {
        const record = latest.get(node.id);
        return record ? markImageAwaitingDelivery([node], node.id, record.clientOperationId)[0] : node;
    });
    const byId = new Map(next.map((node) => [node.id, node]));
    return next.map((node) => {
        if (!node.metadata?.batchChildIds || node.metadata.status !== "loading") return node;
        const children = node.metadata.batchChildIds.map((id) => byId.get(id));
        if (!children.some((child) => child?.metadata?.hostImageDeliveryStatus) || children.some((child) => child?.metadata?.status === "loading")) return node;
        return { ...node, metadata: { ...node.metadata, status: node.metadata.content ? "success" : "error", errorDetails: "图片已生成，等待领取原图。" } };
    }) as T[];
}
