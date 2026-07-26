import { useCallback } from "react";

export function usePluginHost(_params: unknown) {
    return {
        pluginHost: undefined,
        renderPluginPanel: useCallback(() => null, []),
        buildNodeToolbarItems: useCallback(() => [], []),
    };
}
