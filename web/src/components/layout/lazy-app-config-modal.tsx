import { lazy, Suspense } from "react";

import { useConfigStore } from "@/stores/use-config-store";

const AppConfigModal = lazy(() =>
    import("@/components/layout/app-config-modal").then((module) => ({
        default: module.AppConfigModal,
    })),
);

export function LazyAppConfigModal() {
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);

    if (!isConfigOpen) return null;

    return (
        <Suspense
            fallback={
                <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/20 backdrop-blur-sm" role="status" aria-live="polite">
                    <div className="rounded-xl bg-[var(--visionary-surface-solid)] px-4 py-3 text-sm shadow-xl">正在加载配置…</div>
                </div>
            }
        >
            <AppConfigModal />
        </Suspense>
    );
}
