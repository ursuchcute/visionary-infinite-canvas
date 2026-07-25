export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#000000",
            dot: "rgba(163,163,163,.50)",
            line: "rgba(148,163,184,.12)",
            selectionStroke: "#fafaf9",
            selectionFill: "rgba(250,250,249,.10)",
        },
        node: {
            label: "#525252",
            fill: "#e5e5e5",
            panel: "#fafafa",
            stroke: "#d4d4d4",
            activeStroke: "#171717",
            placeholder: "#737373",
            text: "#262626",
            muted: "#737373",
            faint: "#a3a3a3",
        },
        toolbar: {
            panel: "rgba(250,250,250,.96)",
            border: "#d4d4d4",
            item: "#525252",
            itemHover: "#e5e5e5",
            activeBg: "#e5e5e5",
            activeText: "#262626",
        },
    },
    dark: {
        canvas: {
            background: "#000000",
            dot: "rgba(163,163,163,.50)",
            line: "rgba(148,163,184,.12)",
            selectionStroke: "#fafaf9",
            selectionFill: "rgba(250,250,249,.10)",
        },
        node: {
            label: "#d4d4d4",
            fill: "#2b2b2b",
            panel: "#1f1f1f",
            stroke: "#454545",
            activeStroke: "#fafaf9",
            placeholder: "#a3a3a3",
            text: "#f5f5f5",
            muted: "#d4d4d4",
            faint: "#737373",
        },
        toolbar: {
            panel: "rgba(31,31,31,.96)",
            border: "#454545",
            item: "#d4d4d4",
            itemHover: "#2b2b2b",
            activeBg: "#3a3a3a",
            activeText: "#f5f5f5",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
