import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");
const publicBase = `${process.env.VITE_BASE || "/"}`.replace(/\/?$/, "/");
const visionaryHosted = process.env.VITE_VISIONARY_HOSTED === "1";
const hostedAliases = visionaryHosted
    ? [
          { find: "@/router", replacement: resolve(webDir, "src/hosted/router.tsx") },
          { find: "@/components/layout/client-root-init", replacement: resolve(webDir, "src/hosted/client-root-init.tsx") },
          { find: "@/stores/use-config-store", replacement: resolve(webDir, "src/hosted/config-store.ts") },
          { find: "@/stores/use-prompt-source-store", replacement: resolve(webDir, "src/hosted/prompt-source-store.ts") },
          { find: "@/services/api/prompts", replacement: resolve(webDir, "src/hosted/prompts.ts") },
          { find: "@/components/layout/lazy-app-config-modal", replacement: resolve(webDir, "src/hosted/lazy-app-config-modal.tsx") },
          { find: "@/components/agent/lazy-agent-panel", replacement: resolve(webDir, "src/hosted/lazy-agent-panel.tsx") },
          { find: "@/stores/use-agent-store", replacement: resolve(webDir, "src/hosted/use-agent-store.ts") },
          { find: "@/pages/canvas/hooks/use-agent-bridge", replacement: resolve(webDir, "src/hosted/use-agent-bridge.ts") },
          { find: "@/components/canvas/canvas-plugin-manager-modal", replacement: resolve(webDir, "src/hosted/canvas-plugin-manager-modal.tsx") },
          { find: "@/pages/canvas/hooks/use-plugin-host", replacement: resolve(webDir, "src/hosted/use-plugin-host.tsx") },
          { find: "@/services/api/image", replacement: resolve(webDir, "src/hosted/image.ts") },
          { find: "@/services/api/model-plugin", replacement: resolve(webDir, "src/hosted/model-plugin.ts") },
          { find: "@/services/api/audio", replacement: resolve(webDir, "src/hosted/media-generation.ts") },
          { find: "@/services/api/video", replacement: resolve(webDir, "src/hosted/media-generation.ts") },
          { find: "@/components/canvas/canvas-video-settings-popover", replacement: resolve(webDir, "src/hosted/canvas-video-settings-popover.tsx") },
          { find: "@/components/canvas/canvas-audio-settings-popover", replacement: resolve(webDir, "src/hosted/canvas-audio-settings-popover.tsx") },
          { find: "@/lib/seedance-video", replacement: resolve(webDir, "src/hosted/seedance-video.ts") },
      ]
    : [];

// 暴露 /plugins/index.json:列出 public/plugins 下的本地插件文件,
// 供前端自动发现并加入插件列表(默认关闭)。dev 下实时读目录,构建时产出静态清单。
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `${publicBase}plugins/${file}`);
        } catch {
            return [];
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(listLocalPlugins()));
            });
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
        },
    };
}

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    plugins: [react(), ...(visionaryHosted ? [] : [localPluginsManifest()])],
    server: {
        proxy: visionaryHosted
            ? {}
            : {
                  // Route OpenAPI calls through the local dev server. The Visionary
                  // edge endpoint accepts Base64 reference images, while the
                  // same-origin proxy keeps browser requests clear of CORS blocking.
                  "/visionary-api-proxy": {
                      target: "https://api.visionary.beer",
                      changeOrigin: true,
                      rewrite: (path) => path.replace(/^\/visionary-api-proxy/, ""),
                  },
                  // Visionary returns signed image URLs from visionary.beer. Proxy only
                  // that fixed origin so the browser can persist generated images in
                  // IndexedDB without being blocked by cross-origin fetch rules.
                  "/visionary-image-proxy": {
                      target: "https://visionary.beer",
                      changeOrigin: true,
                      rewrite: (path) => path.replace(/^\/visionary-image-proxy/, ""),
                  },
              },
    },
    resolve: {
        alias: [...hostedAliases, { find: "@", replacement: resolve(webDir, "src") }],
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
        __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
    },
});
