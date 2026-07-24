import { Check, Download, Maximize2, Pencil, Trash2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Input } from "antd";

import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { APP_SHORT_NAME } from "@/constant/env";
import { cn } from "@/lib/utils";

export function CanvasProjectCard({ project }: { project: CanvasProject }) {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const renameProject = useCanvasStore((state) => state.renameProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const editing = editingId === project.id;
    const selected = selectedIds.includes(project.id);
    const previewImage = [...project.nodes].reverse().find((node) => node.type === "image" && node.metadata?.content)?.metadata?.content;
    const open = () => navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`);
    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };

    return (
        <article
            className={cn(
                "group cursor-pointer overflow-hidden rounded-[28px] border bg-white/75 shadow-[0_10px_40px_rgba(0,0,0,.06)] backdrop-blur transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_55px_rgba(0,0,0,.12)] dark:bg-white/[.035] dark:shadow-[0_10px_40px_rgba(0,0,0,.25)] dark:hover:bg-white/[.055] dark:hover:shadow-[0_18px_55px_rgba(0,0,0,.38)]",
                selected ? "border-blue-500/70 ring-2 ring-blue-500/15" : "border-black/[.08] hover:border-black/15 dark:border-white/[.08] dark:hover:border-white/15",
            )}
            onClick={() => !editing && open()}
        >
            <div className="relative aspect-[16/9] overflow-hidden border-b border-black/[.06] bg-stone-100 dark:border-white/[.06] dark:bg-[#0b0b0b]">
                {previewImage ? (
                    <img src={previewImage} alt="" className="size-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                ) : (
                    <>
                        <div className="absolute inset-0 bg-gradient-to-br from-white via-stone-100 to-stone-200 dark:from-white/[.08] dark:via-white/[.025] dark:to-transparent" />
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(59,130,246,.16),transparent_38%)]" />
                        <div className="relative grid size-full place-items-center">
                            <span className="grid size-14 place-items-center rounded-2xl border border-black/10 bg-white/70 text-stone-500 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/[.04] dark:text-stone-400"><Maximize2 className="size-5" /></span>
                        </div>
                    </>
                )}
                {previewImage ? <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" /> : null}
                <input
                    type="checkbox"
                    checked={selected}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => toggleSelected(project.id, event.target.checked)}
                    className={cn("absolute left-4 top-4 size-4 accent-stone-950 opacity-100 transition-opacity dark:accent-stone-100 sm:opacity-0 sm:group-hover:opacity-100", selected && "sm:opacity-100")}
                    aria-label={`选择 ${project.title}`}
                />
                <span className="absolute right-4 top-4 rounded-full border border-black/10 bg-white/75 px-2.5 py-1 text-[11px] font-medium text-stone-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-black/45 dark:text-stone-300">{project.nodes.length} 个节点</span>
            </div>
            <div className="p-5">
                <div className="flex min-w-0 items-start gap-3">
                    {editing ? (
                        <Input className="min-w-0" value={editingTitle} onClick={(event) => event.stopPropagation()} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveTitle()} autoFocus />
                    ) : (
                        <button
                            type="button"
                            className="min-w-0 flex-1 cursor-pointer text-left"
                            onClick={(event) => {
                                event.stopPropagation();
                                open();
                            }}
                        >
                            <h2 className="truncate text-lg font-semibold tracking-tight">{project.title}</h2>
                            <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-500">
                                {project.nodes.length} 个节点 · {project.connections.length} 条连线
                            </p>
                        </button>
                    )}
                </div>
                <div className="mt-5 flex items-end justify-between gap-3 border-t border-black/[.06] pt-4 dark:border-white/[.06]">
                    <p className="text-xs text-stone-500 dark:text-stone-500">更新于 {new Date(project.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                    <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                        {editing ? (
                            <>
                                <Button type="text" size="small" className="!size-8 !min-w-8 !rounded-xl" icon={<Check className="size-4" />} onClick={saveTitle} aria-label="保存名称" />
                                <Button type="text" size="small" className="!size-8 !min-w-8 !rounded-xl" icon={<X className="size-4" />} onClick={stopEditing} aria-label="取消重命名" />
                            </>
                        ) : (
                            <>
                                <Button type="text" size="small" className="!size-8 !min-w-8 !rounded-xl !text-stone-500 hover:!bg-black/5 dark:hover:!bg-white/10" icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects([project], project.title || APP_SHORT_NAME)} aria-label="导出" />
                                <Button type="text" size="small" className="!size-8 !min-w-8 !rounded-xl !text-stone-500 hover:!bg-black/5 dark:hover:!bg-white/10" icon={<Pencil className="size-4" />} onClick={() => startEditing(project.id, project.title)} aria-label="重命名" />
                                <Button type="text" size="small" className="!size-8 !min-w-8 !rounded-xl !text-stone-500 hover:!bg-red-500/10 hover:!text-red-500" icon={<Trash2 className="size-4" />} onClick={() => setDeleteIds([project.id])} aria-label="删除" />
                            </>
                        )}
                    </div>
                </div>
            </div>
        </article>
    );
}
