import { create } from "zustand";

type HostedAgentState = {
    token: string;
    enabled: boolean;
    connected: boolean;
    openPanel: () => void;
    connectAgent: (_options?: { silent?: boolean }) => Promise<void>;
};

export const useAgentStore = create<HostedAgentState>(() => ({
    token: "",
    enabled: false,
    connected: false,
    openPanel: () => undefined,
    connectAgent: async () => undefined,
}));
