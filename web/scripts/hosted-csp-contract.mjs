const REQUIRED_PARENT_ORIGIN = "https://visionary.beer";

export function assertCanvasCspHeaders(rawHeaders, { requireBlob = true } = {}) {
    const policyValues = String(rawHeaders || "")
        .split(/\r?\n/)
        .filter((line) => /^content-security-policy\s*:/i.test(line))
        .flatMap((line) =>
            line
                .replace(/^content-security-policy\s*:\s*/i, "")
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
        );
    if (policyValues.length !== 1) {
        throw new Error(`Canvas must return exactly one Content-Security-Policy; received ${policyValues.length}.`);
    }
    const directives = new Map();
    for (const [rawName, ...values] of policyValues[0]
        .split(";")
        .map((part) => part.trim().split(/\s+/))
        .filter(([name]) => Boolean(name))) {
        const name = rawName.toLowerCase();
        if (directives.has(name)) {
            throw new Error(`Canvas Content-Security-Policy repeats the ${name} directive.`);
        }
        directives.set(name, values);
    }
    const frameAncestors = directives.get("frame-ancestors") || [];
    if (frameAncestors.includes("'none'") || !frameAncestors.includes(REQUIRED_PARENT_ORIGIN)) {
        throw new Error("Canvas response is missing the required frame-ancestors CSP.");
    }
    if (requireBlob) {
        const connectSources = directives.get("connect-src") || directives.get("default-src") || [];
        if (connectSources.includes("'none'") || !connectSources.includes("'self'") || !connectSources.includes("blob:")) {
            throw new Error("Canvas response CSP is missing connect-src 'self' blob:.");
        }
    }
}
