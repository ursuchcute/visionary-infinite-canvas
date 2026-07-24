import { lazy, Suspense, useEffect, useState } from "react";

import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

const CanvasDeleteProjectsDialog = lazy(() =>
    import("@/components/canvas/canvas-delete-projects-dialog").then((module) => ({
        default: module.CanvasDeleteProjectsDialog,
    })),
);

export function LazyCanvasDeleteProjectsDialog() {
    const open = useCanvasUiStore((state) => state.deleteProjectIds.length > 0);
    const [mounted, setMounted] = useState(open);

    useEffect(() => {
        if (open) setMounted(true);
    }, [open]);

    if (!mounted && !open) return null;

    return (
        <Suspense
            fallback={
                open ? (
                    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/20 backdrop-blur-sm" role="status" aria-live="polite">
                        <div className="rounded-xl bg-[var(--visionary-surface-solid)] px-4 py-3 text-sm shadow-xl">正在加载删除确认…</div>
                    </div>
                ) : null
            }
        >
            <CanvasDeleteProjectsDialog />
        </Suspense>
    );
}
