export const VISIONARY_HOSTED = import.meta.env.VITE_VISIONARY_HOSTED === "1";
export const VISIONARY_HOST_PROTOCOL_VERSION = 1 as const;
export const VISIONARY_PARENT_ORIGIN = (import.meta.env.VITE_VISIONARY_PARENT_ORIGIN || "https://visionary.beer").trim().replace(/\/+$/, "");
export const VISIONARY_RELEASE_VERSION = (import.meta.env.VITE_VISIONARY_RELEASE_VERSION || "").trim();
export const VISIONARY_SOURCE_REVISION = (import.meta.env.VITE_VISIONARY_SOURCE_REVISION || "").trim();

export const VISIONARY_HOST_BILLING_EVENT = "visionary-host:billing";
export const VISIONARY_HOST_SESSION_INVALID_EVENT = "visionary-host:session-invalid";

export function normalizeHostedModel(value: string) {
    const separator = value.indexOf("::");
    return (separator >= 0 ? value.slice(separator + 2) : value).trim();
}
