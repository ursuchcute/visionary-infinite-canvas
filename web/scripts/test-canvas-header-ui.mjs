import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(path.join(webRoot, relativePath), "utf8");
const canvasPage = readSource("src/pages/canvas/index.tsx");
const canvasProject = readSource("src/pages/canvas/project.tsx");
const canvasTopBar = readSource("src/components/canvas/canvas-top-bar.tsx");
const imageToolbarSettings = readSource("src/components/canvas/canvas-image-toolbar-settings-modal.tsx");
const globalStyles = readSource("src/styles/globals.css");
const appTopNav = readSource("src/components/layout/app-top-nav.tsx");

assert.match(canvasPage, /const hasProjects = hydrated && projects\.length > 0;/);
assert.match(canvasPage, /\{showHeader \? \(\s*<header/);
assert.match(canvasPage, /\{hasProjects \? \(\s*<Button[\s\S]*?>\s*新建画布\s*<\/Button>\s*\) : null\}/);
assert.doesNotMatch(canvasPage, /新建画布后，可以自由连接图片、文本、配置与生成结果/);

assert.match(canvasTopBar, /aria-label="返回画布列表"/);
assert.doesNotMatch(canvasTopBar, /回到主页|requestVisionaryParentHome|visionary-canvas-logo/);
assert.doesNotMatch(canvasTopBar, /导入资产|导出当前画布|展开顶部工具栏/);
assert.doesNotMatch(canvasProject, /<CanvasTopBar[^>]*\bonHome=/);
assert.match(imageToolbarSettings, /className="canvas-image-toolbar-tool-checkbox m-0"/);
assert.match(globalStyles, /\.canvas-image-toolbar-tool-checkbox \.ant-checkbox \{/);
assert.match(globalStyles, /\.canvas-image-toolbar-tool-checkbox \.ant-checkbox\.ant-checkbox-checked/);
assert.match(globalStyles, /background: #22c55e !important/);
assert.match(globalStyles, /border-color: #ffffff !important/);
assert.match(appTopNav, /data-license="AGPL-3\.0"/);
assert.match(appTopNav, /requestVisionaryParentHome\(\)/);
assert.match(appTopNav, /className="inline-flex cursor-pointer[\s\S]*aria-label="回到主页"/);
assert.match(appTopNav, /className="size-7 [^"]*object-cover"/);
assert.equal(appTopNav.match(/<UserStatusActions\b/g)?.length, 1);
assert.match(appTopNav, /\{!VISIONARY_HOSTED \? \(/);
assert.doesNotMatch(appTopNav, /\{VISIONARY_HOSTED \? \([\s\S]*aria-label="回到主页"/);

console.log("Canvas header UI contract passed.");
