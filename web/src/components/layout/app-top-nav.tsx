import { useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";

export function AppTopNav() {
    const { pathname } = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
                <header className="sticky top-0 z-20 h-14 shrink-0 border-b border-[var(--visionary-border)] bg-[var(--visionary-page)] backdrop-blur-2xl">
                    <div className="flex h-full w-full items-center justify-between gap-5 px-5 lg:px-7">
                        <div className="flex min-w-0 items-center">
                            <Link to="/" className="flex shrink-0 items-center gap-2.5 leading-none text-stone-950 transition-opacity hover:opacity-75 dark:text-white" aria-label="Visionary 首页">
                                <span className="relative grid size-9 shrink-0 place-items-center rounded-[11px] bg-gradient-to-br from-white via-stone-200 to-stone-400 shadow-[inset_0_1px_0_rgba(255,255,255,.8),0_5px_16px_rgba(0,0,0,.2)]">
                                    <span className="size-[18px] rotate-45 rounded-[5px] bg-black" />
                                </span>
                                <span className="text-[19px] font-bold tracking-[-.055em]">VISIONARY</span>
                            </Link>
                            <button type="button" className="ml-3 inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 lg:hidden dark:text-stone-300 dark:hover:text-white" onClick={() => setMobileNavOpen(true)} aria-label="打开导航菜单" title="导航菜单">
                                <Menu className="size-5" />
                            </button>
                            <nav className="hide-scrollbar ml-8 hidden h-14 min-w-0 items-center gap-7 overflow-x-auto lg:flex">
                                {navigationTools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={`/${tool.slug}`}
                                            className={cn(
                                                "relative flex h-14 shrink-0 items-center gap-2 text-sm leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full",
                                                active ? "font-medium text-stone-950 after:bg-blue-500 dark:text-white" : "text-stone-500 after:bg-transparent hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100",
                                            )}
                                        >
                                            <Icon className="size-4" />
                                            <span>{tool.label}</span>
                                        </Link>
                                    );
                                })}
                            </nav>
                        </div>
                        <div className="flex h-9 min-w-0 items-center justify-end whitespace-nowrap">
                            <UserStatusActions />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}
