import { lazy, Suspense } from "react";

import { useAgentStore } from "@/stores/use-agent-store";

const AgentPanel = lazy(() =>
    import("@/components/agent/agent-panel").then((module) => ({
        default: module.AgentPanel,
    })),
);

/**
 * Keeps the optional Agent UI out of the initial route bundle. Connected agents
 * still mount the headless panel, while opening the panel gives immediate feedback
 * until its presentation code is ready.
 */
export function LazyAgentPanel() {
    const enabled = useAgentStore((state) => state.enabled);
    const panelMounted = useAgentStore((state) => state.panelMounted);

    if (!enabled && !panelMounted) return null;

    return (
        <Suspense
            fallback={
                panelMounted ? (
                    <div className="fixed right-4 top-4 z-[80] rounded-lg border border-[var(--visionary-border)] bg-[var(--visionary-surface-solid)] px-3 py-2 text-xs shadow-lg" role="status" aria-live="polite">
                        正在加载 Agent…
                    </div>
                ) : null
            }
        >
            <AgentPanel />
        </Suspense>
    );
}
