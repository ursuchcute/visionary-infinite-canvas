import { useEffect, useRef } from "react";
import { House } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { LazyAppConfigModal } from "@/components/layout/lazy-app-config-modal";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";
import { VISIONARY_HOSTED, VISIONARY_RELEASE_VERSION, VISIONARY_SOURCE_REVISION } from "@/constant/visionary-hosted";

const visibleNavigationTools = navigationTools.filter((tool) => tool.slug !== "prompts" && (!VISIONARY_HOSTED || tool.slug === "canvas"));
const VISIONARY_CANVAS_SOURCE_URL = "https://github.com/ursuchcute/visionary-infinite-canvas";

export function AppTopNav() {
    const { pathname } = useLocation();
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = visibleNavigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;
    const activeToolIndex = visibleNavigationTools.findIndex((tool) => tool.slug === activeToolSlug);

    useEffect(() => {
        if (VISIONARY_HOSTED || autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    return (
        <>
            {!hideHeader ? (
                <header className="h-14 shrink-0">
                    <div className="flex h-full w-full items-center justify-between gap-3 px-5 lg:px-7">
                        <div className="flex min-w-0 items-center gap-2">
                            <Link
                                to="/"
                                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-stone-600 transition hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white"
                                aria-label="主页"
                                title="主页"
                            >
                                <House className="size-4" />
                            </Link>
                            {VISIONARY_HOSTED ? (
                                <a
                                    className="truncate text-[11px] text-stone-500 underline decoration-current/25 underline-offset-2 transition hover:text-stone-300"
                                    href={VISIONARY_CANVAS_SOURCE_URL}
                                    target="_blank"
                                    rel="noreferrer"
                                    title={`Visionary Infinite Canvas ${VISIONARY_RELEASE_VERSION || ""} · ${VISIONARY_SOURCE_REVISION || "AGPL-3.0"}`}
                                >
                                    源码 / AGPL-3.0{VISIONARY_RELEASE_VERSION ? ` · ${VISIONARY_RELEASE_VERSION}` : ""}
                                </a>
                            ) : null}
                        </div>
                        {!VISIONARY_HOSTED ? (
                            <div className="flex h-9 min-w-0 items-center justify-end gap-1 whitespace-nowrap">
                                <div className="relative inline-grid shrink-0 grid-cols-2 items-center rounded-xl bg-stone-100 p-0.5 dark:bg-white/[.06]" aria-label="主要页面">
                                    {activeToolIndex >= 0 ? (
                                        <span
                                            aria-hidden
                                            className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-lg bg-[linear-gradient(135deg,#f97316,#ea580c)] shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none"
                                            style={{
                                                width: `calc((100% - 0.25rem) / ${visibleNavigationTools.length})`,
                                                transform: `translate3d(${activeToolIndex * 100}%, 0, 0)`,
                                            }}
                                        />
                                    ) : null}
                                    {visibleNavigationTools.map((tool) => {
                                        const Icon = tool.icon;
                                        const active = tool.slug === activeToolSlug;
                                        return (
                                            <Link
                                                key={tool.slug}
                                                to={`/${tool.slug}`}
                                                className={cn(
                                                    "relative z-10 inline-flex h-8 w-full shrink-0 items-center justify-center gap-2 rounded-lg px-2 text-[14px] font-medium leading-5 transition-colors duration-200 ease-out motion-reduce:transition-none sm:px-2.5",
                                                    active ? "!text-white" : "text-stone-600 hover:text-stone-950 dark:text-stone-300 dark:hover:text-white",
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
                        ) : null}
                    </div>
                </header>
            ) : null}
            <LazyAppConfigModal />
        </>
    );
}
