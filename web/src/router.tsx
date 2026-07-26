import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { VISIONARY_HOSTED } from "@/constant/visionary-hosted";
import UserLayout from "@/layouts/user-layout";

const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const NotFound = lazy(() => import("@/pages/not-found"));

const standaloneRoutes = VISIONARY_HOSTED ? [] : createStandaloneRoutes();

function createStandaloneRoutes() {
    const AssetsPage = lazy(() => import("@/pages/assets"));
    const ImagePage = lazy(() => import("@/pages/image"));
    const PromptsPage = lazy(() => import("@/pages/prompts"));
    const VideoPage = lazy(() => import("@/pages/video"));
    return [
        {
            path: "/image",
            element: (
                <LazyRoute>
                    <ImagePage />
                </LazyRoute>
            ),
        },
        {
            path: "/video",
            element: (
                <LazyRoute>
                    <VideoPage />
                </LazyRoute>
            ),
        },
        {
            path: "/assets",
            element: (
                <LazyRoute>
                    <AssetsPage />
                </LazyRoute>
            ),
        },
        {
            path: "/prompts",
            element: (
                <LazyRoute>
                    <PromptsPage />
                </LazyRoute>
            ),
        },
    ];
}

function LazyRoute({ children }: { children: ReactNode }) {
    return <Suspense fallback={<div className="grid h-full min-h-40 place-items-center bg-[var(--visionary-page)] text-sm text-stone-500">正在加载…</div>}>{children}</Suspense>;
}

export const router = createBrowserRouter(
    [
        {
            element: (
                <UserLayout>
                    {!VISIONARY_HOSTED ? <AnalyticsTracker /> : null}
                    <Outlet />
                </UserLayout>
            ),
            children: [
                { path: "/", element: <Navigate to="/canvas" replace /> },
                ...standaloneRoutes,
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
                ...(!VISIONARY_HOSTED ? [{ path: "/config", element: <Navigate to="/canvas" replace /> }] : []),
            ],
        },
        {
            path: "*",
            element: (
                <LazyRoute>
                    <NotFound />
                </LazyRoute>
            ),
        },
    ],
    { basename: import.meta.env.BASE_URL },
);
