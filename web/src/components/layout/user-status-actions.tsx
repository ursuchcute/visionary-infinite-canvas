import type { CSSProperties } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const theme = useThemeStore((state) => state.theme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;

    if (variant === "canvas") {
        const actionClass = "inline-flex h-7 shrink-0 cursor-pointer items-center justify-center rounded-lg px-1.5 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10 xl:h-8 xl:px-2.5 xl:text-sm";

        return (
            <>
                {onOpenPlugins ? (
                    <button type="button" className={actionClass} style={iconStyle} onClick={onOpenPlugins}>
                        插件
                    </button>
                ) : null}
                {showConfig ? (
                    <button type="button" className={actionClass} style={iconStyle} onClick={() => openConfigDialog(false)}>
                        配置
                    </button>
                ) : null}
                {onOpenShortcuts ? (
                    <button type="button" className={actionClass} style={iconStyle} onClick={onOpenShortcuts}>
                        快捷键
                    </button>
                ) : null}
            </>
        );
    }

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {showConfig ? (
                <button
                    type="button"
                    className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-lg px-2.5 text-[14px] font-medium leading-5 text-stone-700 transition hover:bg-black/5 hover:text-stone-950 dark:text-stone-200 dark:hover:bg-white/10 dark:hover:text-white"
                    style={iconStyle}
                    onClick={() => openConfigDialog(false)}
                >
                    配置
                </button>
            ) : null}
        </div>
    );
}
