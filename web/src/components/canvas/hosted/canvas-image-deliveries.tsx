import { useParams } from "react-router-dom";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { retryHostImageDelivery, useHostImageDeliveryStore } from "@/stores/canvas/use-host-image-delivery-store";

export function CanvasImageDeliveries() {
    const { id: projectId } = useParams();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const entries = useHostImageDeliveryStore((state) => state.entries);
    const pending = Object.values(entries).filter((entry) => entry.projectId === projectId);
    if (!pending.length) return null;
    return (
        <div className="absolute left-16 right-3 top-3 z-[70] max-h-32 overflow-auto text-xs sm:right-auto sm:max-w-md" style={{ color: theme.canvas.selectionStroke }} aria-live="polite">
            {pending.map((entry) => (
                <div key={entry.operationId} className="flex items-center gap-2 py-1">
                    <span>{entry.status === "receiving" ? "图片已生成，正在领取…" : entry.error || "图片已生成，领取暂未完成。"}</span>
                    <button
                        type="button"
                        disabled={entry.status === "receiving"}
                        className="shrink-0 rounded px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
                        onClick={() => retryHostImageDelivery(entry.projectId, entry.operationId)}
                    >
                        重新领取原图
                    </button>
                </div>
            ))}
            <p className="py-1 opacity-70">领取不再扣分，可以继续生成其他图片。</p>
        </div>
    );
}
