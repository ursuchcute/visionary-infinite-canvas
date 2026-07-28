import { MousePointerClick } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasEmptyHint() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div data-canvas-empty-hint className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm font-medium" style={{ color: theme.node.muted }}>
                <span className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                    <MousePointerClick className="size-4 text-sky-500" aria-hidden="true" />
                    双击
                </span>
                <span>画布自由生成</span>
            </div>
        </div>
    );
}
