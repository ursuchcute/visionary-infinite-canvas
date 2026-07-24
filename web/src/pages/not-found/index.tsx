import { Home } from "lucide-react";
import { Link } from "react-router-dom";

export default function NotFound() {
    return (
        <div className="visionary-app flex h-dvh flex-col overflow-hidden text-foreground">
            <main className="visionary-page flex h-full min-h-0 items-center justify-center overflow-y-auto px-6 py-10 text-stone-900 dark:text-stone-100">
                <section className="visionary-surface w-full max-w-md p-10 text-center">
                    <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-2xl border border-[var(--visionary-border)] bg-[var(--visionary-surface-hover)] text-2xl font-semibold shadow-sm">404</div>
                    <h1 className="visionary-title text-3xl font-bold">页面不存在</h1>
                    <p className="mt-3 text-sm leading-6 text-stone-500 dark:text-stone-400">这个地址没有对应的页面，可能已经移动或被合并到其他入口。</p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                        <Link to="/" className="inline-flex h-11 items-center gap-2 rounded-xl bg-stone-950 px-5 text-sm font-medium text-white transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-200">
                            <Home className="size-4" />
                            返回首页
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
}
