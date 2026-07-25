import { useEffect, useRef } from "react";
import { House } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { LazyAppConfigModal } from "@/components/layout/lazy-app-config-modal";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";

export function AppTopNav() {
    const { pathname } = useLocation();
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    useEffect(() => {
        if (autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    return (
        <>
            {!hideHeader ? (
                <header className="h-14 shrink-0">
                    <div className="flex h-full w-full items-center justify-between gap-3 px-5 lg:px-7">
                        <Link
                            to="/"
                            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-stone-600 transition hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white"
                            aria-label="主页"
                            title="主页"
                        >
                            <House className="size-4" />
                        </Link>
                        <div className="flex h-9 min-w-0 items-center justify-end gap-1 whitespace-nowrap">
                            <div className="inline-flex shrink-0 items-center gap-0.5 rounded-xl bg-stone-100 p-0.5 dark:bg-white/[.06]" aria-label="主要页面">
                                {navigationTools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={`/${tool.slug}`}
                                            className={cn(
                                                "inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-lg px-2 text-[14px] font-medium leading-5 transition sm:px-2.5",
                                                active ? "bg-[linear-gradient(135deg,#f97316,#ea580c)] !text-white shadow-sm" : "text-stone-600 hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white",
                                            )}
                                            aria-current={active ? "page" : undefined}
                                            aria-label={tool.label}
                                            title={tool.label}
                                        >
                                            <Icon className="size-4" />
                                            <span className="hidden sm:inline">{tool.label}</span>
                                        </Link>
                                    );
                                })}
                            </div>
                            <UserStatusActions />
                        </div>
                    </div>
                </header>
            ) : null}
            <LazyAppConfigModal />
        </>
    );
}
