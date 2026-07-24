import type { CSSProperties } from "react";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { GitHubLink } from "@/components/layout/github-link";
import { cn } from "@/lib/utils";
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
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-stone-600 transition hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const gitHubClassName = "size-8 text-base";
    const gitHubStyle = iconStyle;

    if (variant === "canvas") {
        const actionClass = "inline-flex h-7 shrink-0 items-center justify-center rounded-lg px-1.5 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10 xl:h-8 xl:px-2.5 xl:text-sm";
        const iconClass = "inline-flex size-7 shrink-0 items-center justify-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/10 xl:size-8 [&_svg]:size-3.5 xl:[&_svg]:size-4";

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
                <span className="mx-0.5 h-4 w-px shrink-0 xl:h-5" style={{ background: canvasTheme.toolbar.border }} />
                <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={iconClass} style={iconStyle} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
                <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", iconClass)} style={gitHubStyle} />
            </>
        );
    }

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {showConfig ? (
                <button type="button" className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-2.5 text-sm font-medium text-stone-700 transition hover:bg-black/5 hover:text-stone-950 dark:text-stone-200 dark:hover:bg-white/10 dark:hover:text-white" style={iconStyle} onClick={() => openConfigDialog(false)}>
                    配置
                </button>
            ) : null}
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
            <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", gitHubClassName)} style={gitHubStyle} />
        </div>
    );
}
