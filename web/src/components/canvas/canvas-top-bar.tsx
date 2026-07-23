import { useState } from "react";
import { BookOpen, Bot, ChevronsDown, ChevronsUp, Download, Home, Upload } from "lucide-react";
import { Modal } from "antd";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { DOCS_URL } from "@/constant/env";

const CANVAS_HEADER_COLLAPSED_KEY = "canvas-header-toolbar-collapsed";

export function CanvasTopBar({
    onHome,
    onExportProject,
    onImportImage,
    onOpenPlugins,
    agentOpen,
    onToggleAgent,
}: {
    onHome: () => void;
    onExportProject: () => void;
    onImportImage: () => void;
    onOpenPlugins: () => void;
    agentOpen: boolean;
    onToggleAgent: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [headerCollapsed, setHeaderCollapsed] = useState(() => typeof window !== "undefined" && localStorage.getItem(CANVAS_HEADER_COLLAPSED_KEY) === "1");
    const actionClass = "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg px-1.5 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10 xl:h-8 xl:gap-1.5 xl:px-2 xl:text-sm [&_svg]:size-3.5 xl:[&_svg]:size-4";
    const toggleClass = "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg px-1.5 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10 xl:h-8 xl:px-2 xl:text-sm [&_svg]:size-3.5 xl:[&_svg]:size-4";

    const toggleHeader = () =>
        setHeaderCollapsed((current) => {
            const next = !current;
            localStorage.setItem(CANVAS_HEADER_COLLAPSED_KEY, next ? "1" : "0");
            return next;
        });

    return (
        <>
            <div className={`pointer-events-none absolute inset-x-0 top-0 z-50 flex h-12 justify-center px-2 xl:h-16 xl:px-4 ${headerCollapsed ? "items-start" : "items-center"}`}>
                <div
                    className={`pointer-events-auto flex items-center overflow-hidden border shadow-sm backdrop-blur ${headerCollapsed ? "h-6 w-12 justify-center rounded-none xl:h-7 xl:w-[60px]" : "h-8 max-w-[calc(100%_-_16px)] rounded-xl xl:h-10"}`}
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                >
                    {!headerCollapsed ? (
                        <>
                            <div className="thin-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-0.5 xl:px-1">
                                <button type="button" className={actionClass} onClick={onHome}>
                                    <Home />主页
                                </button>
                                <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={actionClass}>
                                    <BookOpen />文档
                                </a>
                                <span className="mx-0.5 h-4 w-px shrink-0 xl:h-5" style={{ background: theme.toolbar.border }} />
                                <button type="button" className={actionClass} onClick={onImportImage}>
                                    <Upload />导入资产
                                </button>
                                <button type="button" className={actionClass} onClick={onExportProject}>
                                    <Download />导出当前画布
                                </button>
                                <span className="mx-0.5 h-4 w-px shrink-0 xl:h-5" style={{ background: theme.toolbar.border }} />
                                <UserStatusActions variant="canvas" onOpenShortcuts={() => setShortcutsOpen(true)} onOpenPlugins={onOpenPlugins} />
                                <button type="button" className={actionClass} style={{ background: agentOpen ? theme.toolbar.activeBg : "transparent" }} onClick={onToggleAgent}>
                                    <Bot />Agent
                                </button>
                            </div>
                            <span className="mx-0.5 h-4 w-px shrink-0 xl:h-5" style={{ background: theme.toolbar.border }} />
                        </>
                    ) : null}
                    <button type="button" className={headerCollapsed ? "inline-flex h-5 w-10 items-center justify-center xl:h-6 xl:w-12 [&_svg]:size-3.5 xl:[&_svg]:size-4" : toggleClass} onClick={toggleHeader} aria-label={headerCollapsed ? "展开顶部工具栏" : "收起顶部工具栏"} aria-expanded={!headerCollapsed}>
                        {headerCollapsed ? <ChevronsDown /> : <><ChevronsUp /><span>收起</span></>}
                    </button>
                </div>
            </div>
            <Modal title="快捷键" width={960} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="thin-scrollbar grid max-h-[70vh] grid-cols-1 gap-x-8 gap-y-2 overflow-y-auto border-t pt-4 text-sm sm:grid-cols-2" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["按住 Ctrl（win）/command（mac）", "鼠标左键"]} value="框选多个节点" />
                    <Shortcut keys={["Shift / Ctrl / Cmd", "点击"]} value="追加选择节点" />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value="全选节点" />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value="复制 / 粘贴节点，或粘贴剪切板文本/图片" />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value="撤销" />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value="重做" />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value="重做" />
                    <Shortcut keys={["Delete / Backspace"]} value="删除选中" />
                    <Shortcut keys={["Esc"]} value="取消选择并关闭浮层" />
                    <Shortcut keys={["拖入图片/视频/音频"]} value="上传到画布" />
                </div>
            </Modal>
        </>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_110px] items-center gap-3 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: "rgba(120,113,108,.28)", background: "linear-gradient(#fff, rgba(245,245,244,.92))", color: "rgb(68,64,60)" }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}
