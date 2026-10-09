import { useCallback, useEffect, useRef, useState } from "react";
import { VISIONARY_HOSTED } from "@/constant/visionary-hosted";
import { refreshVisionaryHostCredits } from "@/services/api/visionary-host/client";
import { isHostedVideoSubmitting, releaseHostedVideoSlot, listHostedVideos, recoverHostedVideo, removeHostedVideo, hostedVideoNodeMetadata, type HostedVideoOperation } from "@/services/api/visionary-host/video";
import { withRequestBudget } from "@/services/api/visionary-host/request-budget";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { RefObject } from "react";

function videoSize(record: HostedVideoOperation) {
    const [width, height] = String(record.body.aspectRatio || "16:9")
        .split(":")
        .map(Number);
    return fitNodeSize(480, width > 0 && height > 0 ? (480 * height) / width : 270, 420, 420);
}
export function applyHostedVideoResult(nodes: CanvasNodeData[], record: HostedVideoOperation) {
    const metadata = hostedVideoNodeMetadata(record);
    const target = nodes.find((node) => node.id === record.nodeId);
    const conflict = !target || (target.metadata?.hostOperationId && target.metadata.hostOperationId !== record.clientOperationId) || (target.metadata?.content && target.metadata.hostOperationId !== record.clientOperationId);
    if (conflict) {
        if (metadata.status !== "success") return nodes;
        const id = `host-recovered-video:${record.clientOperationId}`;
        const existing = nodes.find((node) => node.id === id);
        if (existing?.metadata?.hostVideoTaskId === metadata.hostVideoTaskId) return nodes;
        const right = nodes.reduce((edge, node) => Math.max(edge, node.position.x + node.width), 0);
        const fallback: CanvasNodeData = {
            id,
            type: CanvasNodeType.Video,
            title: "恢复的视频",
            position: existing?.position || { x: right + 96, y: 80 },
            ...videoSize(record),
            metadata: { prompt: String(record.body.prompt), model: String(record.body.model), ...metadata },
        };
        return existing ? nodes.map((node) => (node.id === id ? fallback : node)) : [...nodes, fallback];
    }
    const current = target.metadata;
    if (current?.status === metadata.status && current.hostVideoTaskId === metadata.hostVideoTaskId && current.errorDetails === metadata.errorDetails && (metadata.status !== "success" || current.content === metadata.content)) return nodes;
    const { width, height } = videoSize(record);
    return nodes.map((node) => (node.id === target.id ? { ...node, ...(metadata.status === "success" ? { width, height } : {}), metadata: { ...node.metadata, ...metadata } } : node));
}

// One scanner per editing lease. Status polling cannot download/save video
// bytes or block the existing image/text recovery loops.
export function useHostedVideoRecovery(projectId: string, enabled: boolean, nodesRef: RefObject<CanvasNodeData[]>, persist: (nodes: CanvasNodeData[]) => Promise<void>) {
    const [readyProject, setReadyProject] = useState("");
    const wake = useRef<(() => void) | null>(null);
    useEffect(() => {
        if (!VISIONARY_HOSTED || !enabled) return;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | null = null,
            scanning = false;
        const scan = async () => {
            if (scanning || controller.signal.aborted) return;
            scanning = true;
            try {
                const records = await listHostedVideos(projectId);
                controller.signal.throwIfAborted();
                // Restore every admission guard before opening new work.
                let restored = nodesRef.current;
                for (const record of records) restored = applyHostedVideoResult(restored, record);
                if (restored !== nodesRef.current) await persist(restored);
                controller.signal.throwIfAborted();
                setReadyProject(projectId);
                // The server permits four active video slots per user. Scan
                // sequentially at 15s, staying below its 30/min status budget.
                for (const record of records) {
                    try {
                        if (isHostedVideoSubmitting(record.clientOperationId)) continue;
                        const current = await recoverHostedVideo(record, controller.signal);
                        controller.signal.throwIfAborted();
                        const next = applyHostedVideoResult(nodesRef.current, current);
                        if (next !== nodesRef.current) await persist(next);
                        controller.signal.throwIfAborted();
                        const status = hostedVideoNodeMetadata(current).status;
                        if (status !== "loading") {
                            // Even an unchanged retry must cross a fresh flush
                            // barrier before its durable operation is removed.
                            await persist(nodesRef.current);
                            controller.signal.throwIfAborted();
                            await releaseHostedVideoSlot(current, controller.signal);
                            controller.signal.throwIfAborted();
                            await withRequestBudget(controller.signal, 15_000, () => removeHostedVideo(current.clientOperationId));
                            void refreshVisionaryHostCredits(status === "success" ? "settled" : "refunded").catch(() => undefined);
                        }
                    } catch {
                        if (controller.signal.aborted) break;
                    }
                }
            } catch {
                /* Keep guards and retry storage/session/network failures. */
            } finally {
                scanning = false;
                if (!controller.signal.aborted) timer = setTimeout(scan, 15_000);
            }
        };
        wake.current = () => {
            if (timer) clearTimeout(timer);
            void scan();
        };
        void scan();
        return () => {
            controller.abort();
            if (timer) clearTimeout(timer);
            wake.current = null;
        };
    }, [enabled, nodesRef, persist, projectId]);
    const refresh = useCallback(() => wake.current?.(), []);
    return { ready: !VISIONARY_HOSTED || (enabled && readyProject === projectId), refresh };
}
