export const APP_VERSION = __APP_VERSION__ || "dev";

export const APP_NAME = "Visionary Infinite Canvas";
export const APP_SHORT_NAME = "Visionary Canvas";
export const SOURCE_REPOSITORY_URL = "https://github.com/ursuchcute/visionary-infinite-canvas";
export const PUBLIC_APP_URL = import.meta.env.VITE_APP_URL || "https://ursuchcute.github.io/visionary-infinite-canvas/";
export const DOCS_URL = import.meta.env.VITE_DOC_URL || `${SOURCE_REPOSITORY_URL}/tree/main/docs/content/docs`;

export function publicAssetUrl(path: string) {
    return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;
}

// 官方插件清单地址:CI 发布到 plugins-dist 分支,经 jsDelivr 远程拉取;可用环境变量覆盖成自建来源
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/ursuchcute/visionary-infinite-canvas@plugins-dist/official-plugins.json";
