import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasTopBar() {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const navigate = useNavigate();

    return (
        <div className="absolute left-3 top-3 z-[70] xl:left-4 xl:top-4">
            <button
                type="button"
                className="inline-flex size-10 cursor-pointer items-center justify-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/10 xl:size-12"
                style={{ color: theme.node.text }}
                onClick={() => navigate("/canvas")}
                aria-label="返回画布列表"
                title="返回画布列表"
            >
                <ArrowLeft className="size-5 xl:size-6" />
            </button>
        </div>
    );
}
