import type { ReactNode } from "react";

import { LazyAgentPanel } from "@/components/agent/lazy-agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { VISIONARY_HOSTED } from "@/constant/visionary-hosted";

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <div className="visionary-app flex h-dvh overflow-hidden text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            {!VISIONARY_HOSTED ? <LazyAgentPanel /> : null}
        </div>
    );
}
