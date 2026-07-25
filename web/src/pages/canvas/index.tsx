import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button } from "antd";
import { Download, FileUp, Plus } from "lucide-react";

import { LazyCanvasDeleteProjectsDialog } from "@/components/canvas/lazy-canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { APP_SHORT_NAME } from "@/constant/env";

export default function CanvasPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        navigate(`/canvas/${id}${agentQuery}`);
    };
    const createAndEnter = () => enterProject(createProject(`${APP_SHORT_NAME} ${projects.length + 1}`));
    const exportSelectedProjects = async () => {
        const { exportCanvasProjects } = await import("@/lib/canvas/canvas-export");
        await exportCanvasProjects(
            projects.filter((project) => selectedIds.includes(project.id)),
            `${APP_SHORT_NAME}-${selectedIds.length}个项目`,
        );
    };
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const [{ readZip }, { setMediaBlob }, { setImageBlob }] = await Promise.all([import("@/lib/zip"), import("@/services/file-storage"), import("@/services/image-storage")]);
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            await Promise.all(
                data.projects.flatMap((project) =>
                    project.files.map(async (item) => {
                        const blob = zip.get(item.path);
                        if (!blob) return;
                        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                        await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
                    }),
                ),
            );
            data.projects.forEach((item) => importProject(item.project));
            message.success(`已导入 ${data.projects.length} 个画布`);
        } catch {
            message.error("导入失败，请选择有效的画布压缩包");
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        enterProject(mode === "new" ? createProject(`${APP_SHORT_NAME} ${projects.length + 1}`) : projects[0]?.id || createProject(`${APP_SHORT_NAME} ${projects.length + 1}`));
    }, [createProject, hydrated, mode, projects]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">正在打开画布...</main>;

    const secondaryButtonClass =
        "!h-11 !rounded-2xl !border-stone-300/80 !bg-white/75 !px-4 !text-stone-700 !shadow-none backdrop-blur transition hover:!border-stone-400 hover:!bg-white dark:!border-white/10 dark:!bg-white/[.04] dark:!text-stone-200 dark:hover:!border-white/20 dark:hover:!bg-white/[.08]";
    const canvasActionButtonClass = "!h-9 !rounded-md !border-0 !bg-transparent !px-2 !font-medium !text-stone-600 !shadow-none hover:!bg-transparent hover:!text-stone-950 dark:!text-stone-300 dark:hover:!bg-transparent dark:hover:!text-white";

    return (
        <main className="relative isolate h-full overflow-auto bg-[#f5f5f3] text-stone-950 [&_button:not(:disabled)]:cursor-pointer dark:bg-[#050505] dark:text-stone-100">
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(circle_at_50%_-15%,rgba(59,130,246,.12),transparent_46%)] dark:bg-[radial-gradient(circle_at_50%_-15%,rgba(59,130,246,.16),transparent_46%)]"
            />
            <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6 lg:px-8">
                <header className="flex flex-wrap items-center justify-start gap-2.5">
                    {selectedIds.length ? (
                        <>
                            <Button className={secondaryButtonClass} disabled={!hydrated} icon={<Download className="size-4" />} onClick={() => void exportSelectedProjects()}>
                                导出选中
                            </Button>
                            <Button className={`${secondaryButtonClass} !text-red-500 dark:!text-red-400`} disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                                删除选中
                            </Button>
                        </>
                    ) : null}
                    <Button type="text" className={canvasActionButtonClass} disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                        导入画布
                    </Button>
                    <Button type="text" className={canvasActionButtonClass} disabled={!hydrated} icon={<Plus className="size-4" />} onClick={createAndEnter}>
                        新建画布
                    </Button>
                </header>

                {!hydrated ? (
                    <section className="flex min-h-[380px] items-center justify-center rounded-[28px] border border-black/[.08] bg-white/70 text-sm text-stone-500 shadow-[0_10px_40px_rgba(0,0,0,.06)] backdrop-blur dark:border-white/[.08] dark:bg-white/[.03] dark:shadow-[0_10px_40px_rgba(0,0,0,.25)]">
                        正在加载画布...
                    </section>
                ) : projects.length ? (
                    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                ) : null}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <LazyCanvasDeleteProjectsDialog />
        </main>
    );
}
