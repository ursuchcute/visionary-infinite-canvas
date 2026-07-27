import { VISIONARY_HOST_BILLING_EVENT, VISIONARY_HOST_PROTOCOL_VERSION, VISIONARY_HOST_SESSION_INVALID_EVENT, VISIONARY_PARENT_ORIGIN } from "@/constant/visionary-hosted";

import { exchangeVisionaryHostTicket, fetchVisionaryHostBootstrap, VisionaryHostApiError } from "./client";
import type { VisionaryCanvasConnectMessage, VisionaryCanvasNavigateHomeMessage, VisionaryCanvasPortMessage, VisionaryCanvasPortReadyMessage, VisionaryCanvasReadyMessage, VisionaryCanvasSessionEstablishedMessage, VisionaryHostBilling, VisionaryHostBootstrap } from "./contracts";

const CONNECT_TIMEOUT_MS = 15_000;
const SESSION_REFRESH_LEAD_MS = 2 * 60 * 1000;
const FALLBACK_REFRESH_MS = 8 * 60 * 1000;
let activeParentBridge: { port: MessagePort; nonce: string } | null = null;
let navigateHomeFallbackTimer: number | null = null;

export type VisionaryHostSessionCallbacks = {
    onBootstrap: (bootstrap: VisionaryHostBootstrap) => Promise<void> | void;
    onCredits: (credits: number) => void;
    onInvalid: (message: string) => void;
};

export function requestVisionaryParentHome() {
    if (!activeParentBridge) return false;
    const bridge = activeParentBridge;
    const message: VisionaryCanvasNavigateHomeMessage = {
        type: "visionary.canvas.navigate-home",
        protocolVersion: VISIONARY_HOST_PROTOCOL_VERSION,
        nonce: activeParentBridge.nonce,
    };
    bridge.port.postMessage(message);
    if (navigateHomeFallbackTimer !== null) window.clearTimeout(navigateHomeFallbackTimer);
    navigateHomeFallbackTimer = window.setTimeout(() => {
        navigateHomeFallbackTimer = null;
        if (activeParentBridge !== bridge) return;
        const destination = new URL("/", VISIONARY_PARENT_ORIGIN).toString();
        try {
            if (window.top) window.top.location.href = destination;
        } catch {
            window.open(destination, "_top");
        }
    }, 1_000);
    return true;
}

export async function startVisionaryHostSession(callbacks: VisionaryHostSessionCallbacks) {
    const launch = readLaunchContext();
    const port = await connectToParent(launch.nonce);
    activeParentBridge = { port, nonce: launch.nonce };
    let refreshTimer: number | null = null;
    let disposed = false;
    let firstTicketSettled = false;
    let resolveFirstTicket!: (bootstrap: VisionaryHostBootstrap) => void;
    let rejectFirstTicket!: (error: unknown) => void;
    const firstTicket = new Promise<VisionaryHostBootstrap>((resolve, reject) => {
        resolveFirstTicket = resolve;
        rejectFirstTicket = reject;
    });

    const requestTicket = () => {
        if (disposed) return;
        port.postMessage({
            type: "visionary.canvas.ticket.request",
            protocolVersion: VISIONARY_HOST_PROTOCOL_VERSION,
            nonce: launch.nonce,
        });
    };

    const scheduleRefresh = (expiresAt: string) => {
        if (refreshTimer !== null) window.clearTimeout(refreshTimer);
        const expiry = Date.parse(expiresAt);
        const delay = Number.isFinite(expiry) ? Math.max(30_000, expiry - Date.now() - SESSION_REFRESH_LEAD_MS) : FALLBACK_REFRESH_MS;
        refreshTimer = window.setTimeout(requestTicket, delay);
    };
    const forwardCredits = (event: Event) => {
        if (disposed) return;
        const billing = (event as CustomEvent<VisionaryHostBilling>).detail;
        const credits = Number(billing?.remainingCredits);
        port.postMessage({
            type: "visionary.canvas.credits.updated",
            protocolVersion: VISIONARY_HOST_PROTOCOL_VERSION,
            nonce: launch.nonce,
            ...(Number.isFinite(credits) ? { credits } : {}),
        });
    };
    const notifyParentSessionInvalid = (reason?: string) => {
        if (disposed) return;
        port.postMessage({
            type: "visionary.canvas.session.invalid",
            protocolVersion: VISIONARY_HOST_PROTOCOL_VERSION,
            nonce: launch.nonce,
            reason: typeof reason === "string" ? reason : undefined,
        });
    };
    const forwardSessionInvalid = (event: Event) => notifyParentSessionInvalid((event as CustomEvent<string>).detail);
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (refreshTimer !== null) window.clearTimeout(refreshTimer);
        window.removeEventListener(VISIONARY_HOST_BILLING_EVENT, forwardCredits);
        window.removeEventListener(VISIONARY_HOST_SESSION_INVALID_EVENT, forwardSessionInvalid);
        if (navigateHomeFallbackTimer !== null) window.clearTimeout(navigateHomeFallbackTimer);
        navigateHomeFallbackTimer = null;
        if (activeParentBridge?.port === port) activeParentBridge = null;
        port.close();
    };
    const failSession = (reason: string) => {
        callbacks.onInvalid(reason);
        if (!firstTicketSettled) {
            firstTicketSettled = true;
            rejectFirstTicket(new Error(reason));
        }
        dispose();
    };
    window.addEventListener(VISIONARY_HOST_BILLING_EVENT, forwardCredits);
    window.addEventListener(VISIONARY_HOST_SESSION_INVALID_EVENT, forwardSessionInvalid);

    let exchangeChain: Promise<void> = Promise.resolve();
    port.onmessage = (event: MessageEvent<VisionaryCanvasPortMessage>) => {
        if (disposed) return;
        const message = event.data;
        if (!isVersionedMessage(message, launch.nonce)) return;
        if (message.type === "visionary.canvas.credits.updated") {
            if (typeof message.credits === "number" && Number.isFinite(message.credits)) callbacks.onCredits(message.credits);
            return;
        }
        if (message.type === "visionary.canvas.navigate-home.ack") {
            if (navigateHomeFallbackTimer !== null) window.clearTimeout(navigateHomeFallbackTimer);
            navigateHomeFallbackTimer = null;
            return;
        }
        if (message.type === "visionary.canvas.session.invalid") {
            failSession(message.reason || "主站登录状态已失效，请重新登录后再打开画布。");
            return;
        }
        if (message.type === "visionary.canvas.session.closed") {
            failSession(message.reason || "画布会话已关闭，请返回主站重新打开。");
            return;
        }
        if (message.type !== "visionary.canvas.ticket") return;
        exchangeChain = exchangeChain
            .catch(() => undefined)
            .then(async () => {
                if (!message.ticket || Date.parse(message.expiresAt) <= Date.now()) throw new Error("画布登录票据已过期，请重新打开画布。");
                const exchange = await exchangeVisionaryHostTicket(message.ticket, launch.nonce);
                const bootstrap = await fetchVisionaryHostBootstrap();
                await callbacks.onBootstrap(bootstrap);
                scheduleRefresh(exchange.expiresAt);
                const established: VisionaryCanvasSessionEstablishedMessage = {
                    type: "visionary.canvas.session.established",
                    protocolVersion: VISIONARY_HOST_PROTOCOL_VERSION,
                    nonce: launch.nonce,
                };
                port.postMessage(established);
                if (!firstTicketSettled) {
                    firstTicketSettled = true;
                    resolveFirstTicket(bootstrap);
                }
            })
            .catch((error) => {
                const messageText = error instanceof Error ? error.message : "画布连接失败，请重新打开。";
                if (!firstTicketSettled) {
                    firstTicketSettled = true;
                    rejectFirstTicket(error);
                    return;
                }
                if (error instanceof VisionaryHostApiError && (error.status === 403 || error.status === 404)) {
                    notifyParentSessionInvalid(messageText);
                    failSession(messageText);
                    return;
                }
                if (refreshTimer !== null) window.clearTimeout(refreshTimer);
                refreshTimer = window.setTimeout(requestTicket, 1500);
            });
    };
    port.start();

    const firstTicketTimeout = window.setTimeout(() => {
        if (firstTicketSettled) return;
        firstTicketSettled = true;
        rejectFirstTicket(new Error("主站登录票据等待超时，请刷新后重试。"));
    }, CONNECT_TIMEOUT_MS);
    try {
        await firstTicket.finally(() => window.clearTimeout(firstTicketTimeout));
    } catch (error) {
        dispose();
        throw error;
    }
    return dispose;
}

function readLaunchContext() {
    if (window.parent === window) throw new Error("请从 Visionary 主站打开画布。");
    const pattern = new RegExp(`^#embed=1&protocol=${VISIONARY_HOST_PROTOCOL_VERSION}&nonce=([a-f0-9]{32})$`, "i");
    const match = window.location.hash.match(pattern);
    if (!match) {
        throw new Error("画布启动参数无效，请返回主站重新打开。");
    }
    return { nonce: match[1] };
}

function connectToParent(nonce: string) {
    return new Promise<MessagePort>((resolve, reject) => {
        const ready: VisionaryCanvasReadyMessage = {
            type: "visionary.canvas.ready",
            protocolVersion: VISIONARY_HOST_PROTOCOL_VERSION,
            nonce,
        };
        const postReady = () => window.parent.postMessage(ready, VISIONARY_PARENT_ORIGIN);
        const readyInterval = window.setInterval(postReady, 750);
        const timeout = window.setTimeout(() => {
            window.clearInterval(readyInterval);
            window.removeEventListener("message", onMessage);
            reject(new Error("主站连接超时，请刷新后重试。"));
        }, CONNECT_TIMEOUT_MS);
        const onMessage = (event: MessageEvent<VisionaryCanvasConnectMessage>) => {
            if (event.origin !== VISIONARY_PARENT_ORIGIN || event.source !== window.parent) return;
            const message = event.data;
            if (message?.type !== "visionary.canvas.connect" || message.protocolVersion !== VISIONARY_HOST_PROTOCOL_VERSION || message.nonce !== nonce) return;
            const port = event.ports[0];
            if (!port) return;
            window.clearTimeout(timeout);
            window.clearInterval(readyInterval);
            window.removeEventListener("message", onMessage);
            const portReady: VisionaryCanvasPortReadyMessage = {
                type: "visionary.canvas.port-ready",
                protocolVersion: VISIONARY_HOST_PROTOCOL_VERSION,
                nonce,
            };
            port.postMessage(portReady);
            resolve(port);
        };
        window.addEventListener("message", onMessage);
        postReady();
    });
}

function isVersionedMessage(message: VisionaryCanvasPortMessage | null | undefined, nonce: string) {
    return Boolean(message && message.protocolVersion === VISIONARY_HOST_PROTOCOL_VERSION && message.nonce === nonce);
}
