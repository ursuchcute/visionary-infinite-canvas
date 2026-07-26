import { useEffect, type ReactNode } from "react";
import { Button } from "antd";
import { LoaderCircle, ShieldAlert } from "lucide-react";

import { VISIONARY_HOSTED, VISIONARY_HOST_BILLING_EVENT } from "@/constant/visionary-hosted";
import type { VisionaryHostBilling } from "@/services/api/visionary-host/contracts";
import { useVisionaryHostStore } from "@/stores/use-visionary-host-store";

export function VisionaryHostedGate({ children }: { children: ReactNode }) {
    const status = useVisionaryHostStore((state) => state.status);
    const error = useVisionaryHostStore((state) => state.error);
    const initialize = useVisionaryHostStore((state) => state.initialize);
    const applyBilling = useVisionaryHostStore((state) => state.applyBilling);

    useEffect(() => {
        if (!VISIONARY_HOSTED) return;
        void initialize();
    }, [initialize]);

    useEffect(() => {
        if (!VISIONARY_HOSTED) return;
        const onBilling = (event: Event) => applyBilling((event as CustomEvent<VisionaryHostBilling>).detail);
        window.addEventListener(VISIONARY_HOST_BILLING_EVENT, onBilling);
        return () => window.removeEventListener(VISIONARY_HOST_BILLING_EVENT, onBilling);
    }, [applyBilling]);

    if (!VISIONARY_HOSTED || status === "ready") return <>{children}</>;

    if (status === "unavailable") {
        return (
            <main className="grid h-dvh place-items-center bg-[var(--visionary-page)] px-6 text-center text-foreground">
                <section className="max-w-md">
                    <ShieldAlert className="mx-auto size-9 text-orange-500" />
                    <h1 className="mt-4 text-lg font-semibold">画布暂时不可用</h1>
                    <p className="mt-2 text-sm leading-6 text-stone-500">{error || "当前账号无法使用画布，请返回主站后重试。"}</p>
                    <Button className="mt-5" type="primary" onClick={() => window.location.reload()}>
                        重新连接
                    </Button>
                </section>
            </main>
        );
    }

    return (
        <main className="grid h-dvh place-items-center bg-[var(--visionary-page)] text-sm text-stone-500" role="status" aria-live="polite">
            <span className="inline-flex items-center gap-2">
                <LoaderCircle className="size-4 animate-spin" />
                正在连接 Visionary…
            </span>
        </main>
    );
}
