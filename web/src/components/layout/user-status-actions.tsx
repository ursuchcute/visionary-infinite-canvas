import type { CSSProperties } from "react";
import { Coins } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { VISIONARY_HOSTED, VISIONARY_RELEASE_VERSION, VISIONARY_SOURCE_REVISION } from "@/constant/visionary-hosted";
import { useVisionaryHostStore } from "@/stores/use-visionary-host-store";

const VISIONARY_CANVAS_SOURCE_URL = "https://github.com/ursuchcute/visionary-infinite-canvas";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const theme = useThemeStore((state) => state.theme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const credits = useVisionaryHostStore((state) => state.bootstrap?.user.credits);
    const canvasTheme = canvasThemes[theme];
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;

    if (VISIONARY_HOSTED) {
        return (
            <span className="inline-flex h-8 shrink-0 items-center gap-2 px-2 text-xs font-medium" style={iconStyle}>
                <span className="inline-flex items-center gap-1.5" title="当前可用积分">
                    <Coins className="size-3.5 opacity-65" />
                    {credits == null ? "--" : credits}
                </span>
                <span aria-hidden className="h-3 w-px bg-current opacity-20" />
                <a className="whitespace-nowrap underline decoration-current/30 underline-offset-2 transition-opacity hover:opacity-70" href={VISIONARY_CANVAS_SOURCE_URL} target="_blank" rel="noreferrer" title="Visionary Infinite Canvas 源码（AGPL-3.0）">
                    源码 / AGPL-3.0
                </a>
                {VISIONARY_RELEASE_VERSION && VISIONARY_SOURCE_REVISION ? (
                    <a
                        className="max-w-28 truncate opacity-55 transition-opacity hover:opacity-75"
                        href={`${VISIONARY_CANVAS_SOURCE_URL}/tree/${encodeURIComponent(VISIONARY_SOURCE_REVISION)}`}
                        target="_blank"
                        rel="noreferrer"
                        title={`画布版本 ${VISIONARY_RELEASE_VERSION} · 源码 ${VISIONARY_SOURCE_REVISION}`}
                    >
                        {VISIONARY_RELEASE_VERSION}
                    </a>
                ) : null}
            </span>
        );
    }

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
