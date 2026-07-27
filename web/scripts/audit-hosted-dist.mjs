#!/usr/bin/env node

import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(webRoot, "dist");
if (!existsSync(distRoot)) fail("Hosted build is missing web/dist.");
const files = walk(distRoot);
const indexPath = path.join(distRoot, "index.html");

if (!files.includes(indexPath)) fail("Hosted build is missing dist/index.html.");
const symbolicLinks = files.filter((file) => lstatSync(file).isSymbolicLink());
if (symbolicLinks.length) {
    fail(`Hosted build must not publish symbolic links: ${relativeList(symbolicLinks)}`);
}
const sourceMaps = files.filter((file) => file.endsWith(".map"));
if (sourceMaps.length) fail(`Hosted build must not publish source maps: ${relativeList(sourceMaps)}`);

const indexHtml = readFileSync(indexPath, "utf8");
const documentAssets = Array.from(indexHtml.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi), (match) => match[1]);
if (!documentAssets.length) fail("Hosted index.html does not reference any local assets.");
for (const reference of documentAssets) {
    if (!reference.startsWith("/")) {
        fail(`Hosted index.html asset must use the production root base: ${reference}`);
    }
    let assetUrl;
    try {
        assetUrl = new URL(reference, "https://canvas.invalid/");
    } catch {
        fail(`Hosted index.html contains an invalid asset URL: ${reference}`);
    }
    if (assetUrl.origin !== "https://canvas.invalid") {
        fail(`Hosted index.html references a remote script, stylesheet, or asset: ${reference}`);
    }
    let pathname;
    try {
        pathname = decodeURIComponent(assetUrl.pathname);
    } catch {
        fail(`Hosted index.html contains an invalid encoded asset path: ${reference}`);
    }
    const target = path.resolve(distRoot, `.${pathname}`);
    if (!target.startsWith(`${distRoot}${path.sep}`) || !existsSync(target) || !statSync(target).isFile()) {
        fail(`Hosted index.html references a missing or unsafe local asset: ${reference}`);
    }
}
const inlineScripts = Array.from(indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi))
    .map((match) => match[1].trim())
    .filter(Boolean);
if (inlineScripts.length) fail("Hosted index.html contains inline script that the production CSP would block.");

const scriptFiles = files.filter((file) => file.endsWith(".js"));
if (!scriptFiles.length) fail("Hosted build contains no JavaScript bundle.");
const scripts = scriptFiles.map((file) => readFileSync(file, "utf8")).join("\n");

const requiredContracts = [
    ["/api/canvas/v1", "same-origin Canvas API contract"],
    ["visionary.canvas.ready", "parent/child handshake"],
    ["visionary.canvas.session.established", "session establishment acknowledgement"],
    ["AGPL-3.0", "persistent AGPL notice"],
];
for (const [needle, label] of requiredContracts) {
    if (!scripts.includes(needle)) fail(`Hosted build is missing ${label}.`);
}
const expectedRevision = String(process.env.VITE_VISIONARY_SOURCE_REVISION || "").trim();
if (expectedRevision && (!/^[a-f0-9]{40}$/i.test(expectedRevision) || readBuildMetadata("visionary-source-revision") !== expectedRevision)) {
    fail("Hosted build does not contain the exact requested source revision.");
}
const expectedVersion = String(process.env.VITE_VISIONARY_RELEASE_VERSION || "").trim();
if (expectedVersion && readBuildMetadata("visionary-release-version") !== expectedVersion) {
    fail("Hosted build does not contain the requested release version.");
}
const expectedParentOrigin = String(process.env.VITE_VISIONARY_PARENT_ORIGIN || "")
    .trim()
    .replace(/\/+$/, "");
if (expectedParentOrigin && readBuildMetadata("visionary-parent-origin").replace(/\/+$/, "") !== expectedParentOrigin) {
    fail("Hosted build does not contain the requested parent origin.");
}
const expectedBase = String(process.env.VITE_BASE || "").trim();
if (expectedBase && (expectedBase !== "/" || readBuildMetadata("visionary-public-base") !== expectedBase)) {
    fail(`Hosted production base must be exactly /; received ${expectedBase}.`);
}

const deniedPatterns = [
    [/\bapi\.openai\.com\b/i, "direct OpenAI endpoint"],
    [/\bgenerativelanguage\.googleapis\.com\b/i, "direct Gemini endpoint"],
    [/\bapi\.anthropic\.com\b/i, "direct Anthropic endpoint"],
    [/\braw\.githubusercontent\.com\b/i, "raw GitHub content endpoint"],
    [/\bimage-prompts\b/i, "external Image Prompts registry"],
    [/\bofficial-plugins\.json\b/i, "external plugin registry"],
    [/\bplugins\/index\.json\b/i, "local plugin discovery manifest"],
    [/\bwebdav\b/i, "WebDAV integration"],
    [/\bcanvas-agent-url\b/i, "local Agent configuration"],
    [/\b127\.0\.0\.1:17371\b/i, "local Agent endpoint"],
    [/\/v1\/(?:images\/(?:generations|edits)|chat\/completions)\b/i, "legacy direct generation endpoint"],
    [/\/api\/(?:image|video|audio)(?:\/|\b)/i, "legacy media-generation API"],
    [/\bnew Function\s*\(/, "dynamic Function execution"],
    [/\beval\s*\(/, "eval execution"],
    [/\bws:\/\/(?:localhost|127\.0\.0\.1|\[::1\])/i, "local Agent WebSocket"],
    [/\bAuthorization["']?\s*:\s*[`"']Bearer\s/i, "browser Bearer credential construction"],
    [/\bVITE_(?:OPENAI|GEMINI|ANTHROPIC|API)_KEY\b/i, "compiled API-key environment variable"],
];
for (const [pattern, label] of deniedPatterns) {
    if (pattern.test(scripts)) fail(`Hosted build contains forbidden ${label}.`);
}

const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
const scriptBytes = scriptFiles.reduce((sum, file) => sum + statSync(file).size, 0);
console.log(`Hosted dist audit passed: ${files.length} files, ${formatBytes(totalBytes)} total, ${formatBytes(scriptBytes)} JavaScript.`);

function walk(root) {
    const entries = readdirSync(root, { withFileTypes: true });
    return entries.flatMap((entry) => {
        const target = path.join(root, entry.name);
        return entry.isDirectory() ? walk(target) : [target];
    });
}

function relativeList(paths) {
    return paths.map((file) => path.relative(distRoot, file)).join(", ");
}

function readBuildMetadata(name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`<meta\\s+name=["']${escapedName}["']\\s+content=["']([^"']*)["']\\s*\\/?>`, "i").exec(indexHtml);
    return match?.[1] || "";
}

function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function fail(message) {
    console.error(`Hosted dist audit failed: ${message}`);
    process.exit(1);
}
