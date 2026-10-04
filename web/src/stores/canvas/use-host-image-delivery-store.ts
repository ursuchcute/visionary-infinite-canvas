import { create } from "zustand";

export const HOST_IMAGE_DELIVERY_RETRY_EVENT = "visionary:canvas-image-delivery-retry";
export type HostImageDelivery = { projectId: string; operationId: string; status: "receiving" | "failed"; error?: string };

export const useHostImageDeliveryStore = create<{ entries: Record<string, HostImageDelivery> }>(() => ({ entries: {} }));

export function setHostImageDelivery(entry: HostImageDelivery) {
    useHostImageDeliveryStore.setState((state) => {
        const current = state.entries[entry.operationId];
        if (current?.status === entry.status && current.error === entry.error && current.projectId === entry.projectId) return state;
        return { entries: { ...state.entries, [entry.operationId]: entry } };
    });
}

export function getHostImageDelivery(operationId: string) {
    return useHostImageDeliveryStore.getState().entries[operationId];
}

export function clearHostImageDelivery(operationId: string) {
    useHostImageDeliveryStore.setState((state) => {
        if (!state.entries[operationId]) return state;
        const entries = { ...state.entries };
        delete entries[operationId];
        return { entries };
    });
}

export function retryHostImageDelivery(projectId: string, operationId: string) {
    window.dispatchEvent(new CustomEvent(HOST_IMAGE_DELIVERY_RETRY_EVENT, { detail: { projectId, operationId } }));
}
