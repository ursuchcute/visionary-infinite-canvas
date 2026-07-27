import { useState } from "react";
import { App, Button, Modal } from "antd";

import { VISIONARY_HOSTED } from "@/constant/visionary-hosted";
import {
    CanvasProjectInUseError,
    CanvasProjectLockUnsupportedError,
    withHostedCanvasStoreLock,
} from "@/lib/canvas/canvas-project-lock";
import { cleanupUnusedMedia } from "@/services/file-storage";
import { cleanupUnusedImages } from "@/services/image-storage";
import { listHostOperations, listHostTextOperations } from "@/services/api/visionary-host/operations";
import { useAssetStore } from "@/stores/use-asset-store";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog() {
    const { message } = App.useApp();
    const [deleting, setDeleting] = useState(false);
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const confirm = async () => {
        if (deleting) return;
        setDeleting(true);
        try {
            await withHostedCanvasStoreLock(async () => {
                const previousProjects = useCanvasStore.getState().projects;
                const currentProjectIds = new Set(previousProjects.map((project) => project.id));
                const existingIds = ids.filter((projectId) => currentProjectIds.has(projectId));
                if (!existingIds.length) throw new Error("PROJECT_NOT_FOUND");
                if (VISIONARY_HOSTED) {
                    const operationCounts = await Promise.all(existingIds.map(async (projectId) => (await listHostOperations(projectId)).length + (await listHostTextOperations(projectId)).length));
                    if (operationCounts.some((count) => count > 0)) {
                        throw new Error("PROJECT_HAS_OPERATIONS");
                    }
                }
                try {
                    deleteProjects(existingIds);
                    await flushCanvasStorePersistence();
                } catch (error) {
                    useCanvasStore.setState({ projects: previousProjects });
                    throw error;
                }
                const usedData = {
                    assets: useAssetStore.getState().assets,
                    projects: useCanvasStore.getState().projects,
                };
                try {
                    await Promise.all([cleanupUnusedImages(usedData), cleanupUnusedMedia(usedData)]);
                } catch {
                    // Project deletion is already durable. Blob cleanup is
                    // recoverable housekeeping and must not roll the UI back.
                    message.warning("画布已删除，部分本地缓存将在下次清理。");
                }
                removeSelectedIds(ids);
                setDeleteIds([]);
            });
        } catch (error) {
            if (error instanceof CanvasProjectInUseError) {
                message.warning("另一个页面正在使用画布，请先关闭后再删除。");
            } else if (error instanceof CanvasProjectLockUnsupportedError) {
                message.error("当前浏览器不支持安全画布锁，请升级浏览器后再删除。");
            } else if (error instanceof Error && error.message === "PROJECT_HAS_OPERATIONS") {
                message.warning("所选画布仍有任务正在生成、确认或等待恢复，请先打开画布完成恢复后再删除。");
            } else if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
                removeSelectedIds(ids);
                setDeleteIds([]);
                message.warning("所选画布已在其他页面删除，列表已刷新。");
            } else {
                message.error("暂时无法确认画布任务状态，请稍后重试。");
            }
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Modal
            title="删除画布？"
            open={ids.length > 0}
            centered
            onCancel={() => !deleting && setDeleteIds([])}
            footer={
                <>
                    <Button disabled={deleting} onClick={() => setDeleteIds([])}>
                        取消
                    </Button>
                    <Button danger type="primary" loading={deleting} onClick={() => void confirm()}>
                        删除
                    </Button>
                </>
            }
        >
            <p className="text-sm text-stone-500">将删除 {ids.length} 个画布，里面的节点和连线也会一起移除。</p>
        </Modal>
    );
}
