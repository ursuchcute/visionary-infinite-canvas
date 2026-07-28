import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

const PREVIEW_WIDTH = 288;
const PREVIEW_HEIGHT = 176;
const PREVIEW_MARGIN = 12;
const PREVIEW_GAP = 10;

type CanvasImageReferenceAttachmentsProps = {
    targetNodeId: string;
    references: CanvasResourceReference[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onRemove: (reference: CanvasResourceReference) => void;
};

export function CanvasImageReferenceAttachments({ targetNodeId, references, theme, onRemove }: CanvasImageReferenceAttachmentsProps) {
    if (!references.length) return null;

    return (
        <div data-canvas-image-reference-strip className="mb-2 flex min-h-14 flex-wrap items-center gap-2 px-1">
            {references.map((reference) => (
                <CanvasImageReferenceAttachment key={reference.nodeId} targetNodeId={targetNodeId} reference={reference} theme={theme} onRemove={onRemove} />
            ))}
        </div>
    );
}

function CanvasImageReferenceAttachment({
    targetNodeId,
    reference,
    theme,
    onRemove,
}: {
    targetNodeId: string;
    reference: CanvasResourceReference;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onRemove: (reference: CanvasResourceReference) => void;
}) {
    const anchorRef = useRef<HTMLDivElement>(null);
    const [previewPosition, setPreviewPosition] = useState<{ left: number; top: number } | null>(null);

    useLayoutEffect(() => {
        if (!previewPosition) return;

        const syncPosition = () => {
            const rect = anchorRef.current?.getBoundingClientRect();
            if (!rect) return;
            const left = Math.max(PREVIEW_MARGIN, Math.min(window.innerWidth - PREVIEW_WIDTH - PREVIEW_MARGIN, rect.left + rect.width / 2 - PREVIEW_WIDTH / 2));
            const preferredTop = rect.top - PREVIEW_HEIGHT - PREVIEW_GAP;
            const fallbackTop = Math.min(window.innerHeight - PREVIEW_HEIGHT - PREVIEW_MARGIN, rect.bottom + PREVIEW_GAP);
            setPreviewPosition((current) => {
                const next = { left, top: Math.max(PREVIEW_MARGIN, preferredTop >= PREVIEW_MARGIN ? preferredTop : fallbackTop) };
                return current?.left === next.left && current.top === next.top ? current : next;
            });
        };

        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
        };
    }, [previewPosition]);

    const showPreview = () => {
        if (!reference.previewUrl) return;
        const rect = anchorRef.current?.getBoundingClientRect();
        if (!rect) return;
        const left = Math.max(PREVIEW_MARGIN, Math.min(window.innerWidth - PREVIEW_WIDTH - PREVIEW_MARGIN, rect.left + rect.width / 2 - PREVIEW_WIDTH / 2));
        const preferredTop = rect.top - PREVIEW_HEIGHT - PREVIEW_GAP;
        const fallbackTop = Math.min(window.innerHeight - PREVIEW_HEIGHT - PREVIEW_MARGIN, rect.bottom + PREVIEW_GAP);
        setPreviewPosition({ left, top: Math.max(PREVIEW_MARGIN, preferredTop >= PREVIEW_MARGIN ? preferredTop : fallbackTop) });
    };

    const preview =
        previewPosition && reference.previewUrl && typeof document !== "undefined"
            ? createPortal(
                  <div
                      data-canvas-reference-preview
                      className="pointer-events-none fixed z-[5000] overflow-hidden rounded-2xl border shadow-2xl"
                      style={{
                          left: previewPosition.left,
                          top: previewPosition.top,
                          width: PREVIEW_WIDTH,
                          height: PREVIEW_HEIGHT,
                          background: theme.toolbar.panel,
                          borderColor: theme.toolbar.border,
                      }}
                  >
                      <img src={reference.previewUrl} alt="" className="h-full w-full object-cover" />
                      <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8 text-sm font-semibold text-white">@{reference.title || reference.label}</div>
                  </div>,
                  document.body,
              )
            : null;

    return (
        <div ref={anchorRef} className="group relative" onMouseEnter={showPreview} onMouseLeave={() => setPreviewPosition(null)}>
            <div className="relative grid size-14 place-items-center overflow-hidden rounded-xl border" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                {reference.previewUrl ? <img src={reference.previewUrl} alt={reference.title} className="h-full w-full object-cover" /> : <ImageIcon className="size-5 opacity-45" />}
                {reference.nodeId !== targetNodeId ? (
                    <button
                        type="button"
                        className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/75 text-white opacity-0 transition hover:bg-black group-hover:opacity-100"
                        aria-label={`移除参考图 ${reference.title || reference.label}`}
                        title="移除参考图并断开连线"
                        onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onRemove(reference);
                        }}
                    >
                        <X className="size-3.5" />
                    </button>
                ) : null}
            </div>
            {preview}
        </div>
    );
}
