import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ContextMenuState } from "@/types/canvas";

export function CanvasNodeContextMenu({ menu, onClose, onDuplicate, onDelete }: { menu: ContextMenuState; onClose: () => void; onDuplicate: () => void; onDelete: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ left: menu.x, top: menu.y });

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    useLayoutEffect(() => {
        const element = menuRef.current;
        if (!element) return;
        const updatePosition = () => {
            const padding = 8;
            const next = {
                left: Math.min(Math.max(padding, menu.x), Math.max(padding, window.innerWidth - element.offsetWidth - padding)),
                top: Math.min(Math.max(padding, menu.y), Math.max(padding, window.innerHeight - element.offsetHeight - padding)),
            };
            setPosition((current) => (current.left === next.left && current.top === next.top ? current : next));
        };
        updatePosition();
        const observer = new ResizeObserver(updatePosition);
        observer.observe(element);
        window.addEventListener("resize", updatePosition);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", updatePosition);
        };
    }, [menu.x, menu.y, menu.type]);

    return createPortal(
        <div
            ref={menuRef}
            className="fixed z-[2000] min-w-44 overflow-hidden rounded-xl border py-1 shadow-2xl"
            style={{ left: position.left, top: position.top, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {menu.type === "node" ? <MenuButton icon={<Plus className="size-4" />} label="复制" onClick={onDuplicate} /> : null}
            <MenuButton icon={<Trash2 className="size-4" />} label="删除" onClick={onDelete} danger />
        </div>,
        document.body,
    );
}

function MenuButton({ icon, label, onClick, danger = false }: { icon: ReactNode; label: string; onClick?: () => void; danger?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80" style={{ color: danger ? "#f87171" : theme.node.text }} onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}
