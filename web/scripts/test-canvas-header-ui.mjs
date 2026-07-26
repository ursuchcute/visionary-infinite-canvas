import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(path.join(webRoot, relativePath), "utf8");
const canvasPage = readSource("src/pages/canvas/index.tsx");
const canvasProject = readSource("src/pages/canvas/project.tsx");
const canvasTopBar = readSource("src/components/canvas/canvas-top-bar.tsx");
const appTopNav = readSource("src/components/layout/app-top-nav.tsx");

assert.match(canvasPage, /const hasProjects = hydrated && projects\.length > 0;/);
assert.match(canvasPage, /\{showHeader \? \(\s*<header/);
assert.match(canvasPage, /\{hasProjects \? \(\s*<Button[\s\S]*?>\s*新建画布\s*<\/Button>\s*\) : null\}/);
assert.doesNotMatch(canvasPage, /新建画布后，可以自由连接图片、文本、配置与生成结果/);

assert.doesNotMatch(canvasTopBar, /\bonHome\b/);
assert.doesNotMatch(canvasTopBar, /\bHome\b/);
assert.doesNotMatch(canvasTopBar, />\s*主页\s*</);
assert.match(canvasTopBar, /\bjustify-center\b/);
assert.doesNotMatch(canvasTopBar, /\bjustify-start\b/);
assert.equal(canvasTopBar.match(/<UserStatusActions\b/g)?.length, 1);
assert.match(canvasTopBar, /!VISIONARY_HOSTED \? <UserStatusActions/);
assert.doesNotMatch(canvasTopBar, /showConfig=\{false\}/);
assert.doesNotMatch(canvasTopBar, /absolute right-2 top-2/);
assert.doesNotMatch(canvasProject, /<CanvasTopBar[^>]*\bonHome=/);
assert.match(appTopNav, /\{!VISIONARY_HOSTED \? \(\s*<div className="flex h-9/);
assert.equal(appTopNav.match(/<UserStatusActions\b/g)?.length, 1);
assert.match(appTopNav, /源码 \/ AGPL-3\.0/);
assert.match(appTopNav, /\{VISIONARY_HOSTED \? \(/);

console.log("Canvas header UI contract passed.");
