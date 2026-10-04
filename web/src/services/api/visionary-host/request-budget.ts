// The deadline covers response bodies as well as headers. Aborting fetch alone
// cannot release a caller stuck in a browser storage operation.
export async function withRequestBudget<T>(parent: AbortSignal | null | undefined, timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let rejectAbort: (error: Error) => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => {
        rejectAbort = reject;
    });
    const onAbort = () => rejectAbort(controller.signal.reason || new DOMException("Aborted", "AbortError"));
    const fromParent = () => controller.abort(new DOMException("Aborted", "AbortError"));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    parent?.addEventListener("abort", fromParent, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException("请求等待超时，请稍后重试。", "TimeoutError")), timeoutMs);
    if (parent?.aborted) fromParent();
    try {
        if (controller.signal.aborted) return await aborted;
        return await Promise.race([run(controller.signal), aborted]);
    } finally {
        clearTimeout(timer);
        parent?.removeEventListener("abort", fromParent);
        controller.signal.removeEventListener("abort", onAbort);
    }
}
