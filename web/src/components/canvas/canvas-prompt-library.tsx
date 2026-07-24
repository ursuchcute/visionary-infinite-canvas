import { useState } from "react";
import { Button, Tooltip } from "antd";
import { BookOpen, Plus } from "lucide-react";

import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasPromptLibrary({ onSelect, variant = "default" }: { onSelect: (prompt: string) => void; variant?: "default" | "add" }) {
    const [open, setOpen] = useState(false);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <Tooltip title={variant === "add" ? "添加提示词" : "提示词库"}>
                <Button
                    type="text"
                    className={variant === "add" ? "!h-10 !w-10 !min-w-10 shrink-0 !rounded-xl !border-0 !p-0" : "!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0"}
                    style={{ background: variant === "add" ? theme.toolbar.activeBg : "transparent", color: theme.node.text }}
                    icon={variant === "add" ? <Plus className="size-5" /> : <BookOpen className="size-3.5" />}
                    onClick={() => setOpen(true)}
                    aria-label={variant === "add" ? "添加提示词" : "提示词库"}
                />
            </Tooltip>
            <PromptSelectDialog open={open} onOpenChange={setOpen} onSelect={onSelect} />
        </>
    );
}
