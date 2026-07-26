import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";

import UserLayout from "@/layouts/user-layout";

const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));

function LazyRoute({ children }: { children: ReactNode }) {
    return <Suspense fallback={<div className="grid h-full min-h-40 place-items-center bg-[var(--visionary-page)] text-sm text-stone-500">正在加载…</div>}>{children}</Suspense>;
}

export const router = createBrowserRouter(
    [
        {
            element: (
                <UserLayout>
                    <Outlet />
                </UserLayout>
            ),
            children: [
                { path: "/", element: <Navigate to="/canvas" replace /> },
                {
                    path: "/canvas",
                    element: (
                        <LazyRoute>
                            <CanvasPage />
                        </LazyRoute>
                    ),
                },
                {
                    path: "/canvas/:id",
                    element: (
                        <LazyRoute>
                            <CanvasProjectPage />
                        </LazyRoute>
                    ),
                },
                { path: "*", element: <Navigate to="/canvas" replace /> },
            ],
        },
    ],
    { basename: import.meta.env.BASE_URL },
);
