import { useEffect, useRef, useState } from "react";

import type { CanvasProjectCoverSource } from "@/lib/canvas/canvas-project-cover";

const visibilityCallbacks = new WeakMap<Element, () => void>();
let coverObserver: IntersectionObserver | null = null;

function observeCover(element: Element, onVisible: () => void) {
    if (typeof IntersectionObserver === "undefined") {
        onVisible();
        return () => undefined;
    }
    if (!coverObserver) {
        coverObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    const callback = visibilityCallbacks.get(entry.target);
                    visibilityCallbacks.delete(entry.target);
                    coverObserver?.unobserve(entry.target);
                    callback?.();
                });
            },
            { rootMargin: "320px 0px" },
        );
    }
    visibilityCallbacks.set(element, onVisible);
    coverObserver.observe(element);
    return () => {
        visibilityCallbacks.delete(element);
        coverObserver?.unobserve(element);
    };
}

export function CanvasProjectCover({ source }: { source: CanvasProjectCoverSource }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const sourceFingerprintRef = useRef(source.fingerprint);
    const [visible, setVisible] = useState(false);
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [imageKind, setImageKind] = useState<"thumbnail" | "original" | null>(null);
    const [loaded, setLoaded] = useState(false);
    sourceFingerprintRef.current = source.fingerprint;

    useEffect(() => {
        setVisible(false);
        setImageUrl(null);
        setImageKind(null);
        setLoaded(false);
        const element = containerRef.current;
        if (!element) return;
        return observeCover(element, () => setVisible(true));
    }, [source]);

    useEffect(() => {
        if (!visible) return;
        let active = true;

        void import("@/services/canvas-project-cover")
            .then(async ({ ensureCanvasProjectCover, getCachedCanvasProjectCover, resolveCanvasProjectCoverOriginal }) => {
                if (!active) return;
                const cached = await getCachedCanvasProjectCover(source);
                if (!active) return;
                if (cached) {
                    setImageKind("thumbnail");
                    setImageUrl(cached);
                    return;
                }

                const original = await resolveCanvasProjectCoverOriginal(source);
                if (!active) return;
                setImageKind("original");
                setImageUrl(original || null);

                const generated = await ensureCanvasProjectCover(source);
                if (!active || !generated) return;
                setImageKind("thumbnail");
                setImageUrl(generated);
            })
            .catch(() => {
                if (!active) return;
                setImageKind("original");
                setImageUrl(source.url || null);
            });

        return () => {
            active = false;
        };
    }, [source, visible]);

    const recoverOriginal = () => {
        const fingerprint = source.fingerprint;
        if (imageKind === "original") {
            setImageUrl(null);
            return;
        }
        void import("@/services/canvas-project-cover")
            .then(async ({ resolveCanvasProjectCoverOriginal }) => {
                const original = await resolveCanvasProjectCoverOriginal(source);
                if (sourceFingerprintRef.current !== fingerprint) return;
                setImageKind("original");
                setImageUrl(original || null);
            })
            .catch(() => {
                if (sourceFingerprintRef.current !== fingerprint) return;
                setImageKind("original");
                setImageUrl(source.url || null);
            });
    };

    return (
        <div ref={containerRef} className="absolute inset-0">
            {imageUrl ? (
                <img
                    data-project-cover={imageKind || undefined}
                    src={imageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className={`size-full object-cover transition duration-500 group-hover:scale-[1.03] ${loaded ? "opacity-100" : "opacity-0"}`}
                    onLoad={() => setLoaded(true)}
                    onError={recoverOriginal}
                />
            ) : null}
        </div>
    );
}
