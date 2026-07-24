import { spawn, spawnSync } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const BENCHMARK_NODE_COUNTS = [100, 500];
const HOST = "127.0.0.1";
const PORT = 4176;
const BASE_URL = `http://${HOST}:${PORT}`;
const CHROME_PATHS = [process.env.VCANVAS_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");

async function findChrome() {
    for (const executablePath of CHROME_PATHS) {
        try {
            await access(executablePath);
            return executablePath;
        } catch {
            // 尝试下一个本机浏览器路径。
        }
    }
    throw new Error("找不到 Chrome/Chromium。可通过 VCANVAS_CHROME_PATH 指定浏览器可执行文件。");
}

function supportsVite(version) {
    const [major, minor] = version.split(".").map(Number);
    return (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22;
}

async function findViteNode() {
    const candidates = [process.env.VCANVAS_NODE_PATH, process.execPath].filter(Boolean);
    const nvmVersionsDir = path.join(os.homedir(), ".nvm", "versions", "node");
    try {
        const nvmVersions = await readdir(nvmVersionsDir, { withFileTypes: true });
        candidates.push(...nvmVersions.filter((entry) => entry.isDirectory()).map((entry) => path.join(nvmVersionsDir, entry.name, "bin", "node")));
    } catch {
        // nvm 未安装时继续使用当前 Node。
    }

    for (const executablePath of candidates) {
        const result = spawnSync(executablePath, ["-p", "process.versions.node"], { encoding: "utf8" });
        if (result.status === 0 && supportsVite(result.stdout.trim())) return executablePath;
    }
    throw new Error("找不到满足 Vite 7 要求的 Node（>=20.19 或 >=22.12）。可通过 VCANVAS_NODE_PATH 指定。");
}

async function waitForServer(server) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        if (server.exitCode !== null) throw new Error(`Vite 提前退出，退出码 ${server.exitCode}`);
        try {
            const response = await fetch(BASE_URL);
            if (response.ok) return;
        } catch {
            // Vite 仍在启动。
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("等待 Vite 启动超时");
}

function percentile(values, ratio) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

async function seedProject(page, nodeCount) {
    await page.goto(`${BASE_URL}/canvas`, { waitUntil: "networkidle" });
    const projectId = await page.evaluate(async (count) => {
        const [{ useCanvasStore }, { createCanvasNode }, { CanvasNodeType }] = await Promise.all([import("/src/stores/canvas/use-canvas-store.ts"), import("/src/lib/canvas/canvas-node-factory.ts"), import("/src/types/canvas.ts")]);

        const hydrationDeadline = performance.now() + 10_000;
        while (!useCanvasStore.getState().hydrated) {
            if (performance.now() > hydrationDeadline) throw new Error("画布存储初始化超时");
            await new Promise((resolve) => setTimeout(resolve, 20));
        }

        const columns = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / columns);
        const nodes = Array.from({ length: count }, (_, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            return createCanvasNode(CanvasNodeType.Text, {
                x: (column - columns / 2) * 360,
                y: (row - rows / 2) * 240,
            });
        });
        const connections = nodes.slice(1).map((node, index) => ({
            id: `benchmark-connection-${index}`,
            fromNodeId: nodes[index].id,
            toNodeId: node.id,
        }));
        return useCanvasStore.getState().importProject({
            title: `Benchmark ${count}`,
            nodes,
            connections,
            viewport: { x: 720, y: 450, k: 1 },
        });
    }, nodeCount);

    // Zustand 持久层有 400ms 合并写入；等待测试项目写入隔离浏览器的 IndexedDB。
    await page.waitForTimeout(650);
    return projectId;
}

async function runCase(browser, nodeCount) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const projectId = await seedProject(page, nodeCount);
    await page.goto(`${BASE_URL}/canvas/${projectId}`, { waitUntil: "networkidle" });
    const canvas = page.locator("[data-canvas-root]");
    await canvas.waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
        const benchmarkWindow = window;
        benchmarkWindow.__VCANVAS_BENCHMARK__ = { active: true, projectCommits: 0 };
        const canvasElement = document.querySelector("[data-canvas-viewport]");
        if (canvasElement) canvasElement.dataset.canvasViewportUpdates = "0";

        const state = {
            active: true,
            startedAt: performance.now(),
            frameTimes: [],
            longTasks: [],
            observer: null,
        };
        const sampleFrame = (now) => {
            if (!state.active) return;
            state.frameTimes.push(now);
            requestAnimationFrame(sampleFrame);
        };
        requestAnimationFrame(sampleFrame);

        if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
            state.observer = new PerformanceObserver((list) => {
                state.longTasks.push(...list.getEntries().map((entry) => entry.duration));
            });
            state.observer.observe({ type: "longtask" });
        }
        benchmarkWindow.__VCANVAS_FRAME_SAMPLE__ = state;
    });

    const box = await canvas.boundingBox();
    if (!box) throw new Error("无法读取画布尺寸");
    const startX = box.x + box.width * 0.5;
    const startY = box.y + box.height * 0.52;
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: "middle" });
    for (let index = 0; index < 120; index += 1) {
        const progress = index / 119;
        await page.mouse.move(startX + Math.sin(progress * Math.PI * 2) * 280, startY + Math.sin(progress * Math.PI * 4) * 90);
        await page.waitForTimeout(8);
    }
    await page.mouse.up({ button: "middle" });
    await page.waitForTimeout(750);

    const raw = await page.evaluate(() => {
        const benchmarkWindow = window;
        const state = benchmarkWindow.__VCANVAS_FRAME_SAMPLE__;
        state.active = false;
        state.observer?.disconnect();
        benchmarkWindow.__VCANVAS_BENCHMARK__.active = false;
        const canvasElement = document.querySelector("[data-canvas-viewport]");
        return {
            duration: performance.now() - state.startedAt,
            frameTimes: state.frameTimes,
            longTasks: state.longTasks,
            projectCommits: benchmarkWindow.__VCANVAS_BENCHMARK__.projectCommits,
            viewportUpdates: Number(canvasElement?.dataset.canvasViewportUpdates || "0"),
            renderedNodes: document.querySelectorAll("[data-node-id]").length,
            renderedConnections: document.querySelectorAll("[data-connection-id]").length,
        };
    });

    const viewportBeforeZoom = await canvas.getAttribute("data-canvas-viewport");
    await canvas.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        element.dispatchEvent(
            new WheelEvent("wheel", {
                deltaY: -160,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2,
                bubbles: true,
                cancelable: true,
            }),
        );
    });
    await page.waitForTimeout(850);
    const viewportPersistence = await page.evaluate(async (id) => {
        const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts");
        const serialized = document.querySelector("[data-canvas-viewport]")?.getAttribute("data-canvas-viewport") || "";
        const [x, y, k] = serialized.split(",").map(Number);
        const persisted = useCanvasStore.getState().openProject(id)?.viewport;
        return {
            serialized,
            persisted: Boolean(persisted && Math.abs(persisted.x - x) < 0.02 && Math.abs(persisted.y - y) < 0.02 && Math.abs(persisted.k - k) < 0.001),
        };
    }, projectId);

    const frameIntervals = raw.frameTimes.slice(1).map((time, index) => time - raw.frameTimes[index]);
    const result = {
        nodes: nodeCount,
        connections: nodeCount - 1,
        renderedNodes: raw.renderedNodes,
        renderedConnections: raw.renderedConnections,
        durationMs: Math.round(raw.duration),
        viewportUpdates: raw.viewportUpdates,
        projectCommits: raw.projectCommits,
        commitIsolationRatio: raw.viewportUpdates ? Number((raw.projectCommits / raw.viewportUpdates).toFixed(3)) : 0,
        averageFps: raw.duration ? Number((((raw.frameTimes.length - 1) * 1000) / raw.duration).toFixed(1)) : 0,
        p95FrameMs: Number(percentile(frameIntervals, 0.95).toFixed(2)),
        framesOver25ms: frameIntervals.filter((value) => value > 25).length,
        longTasks: raw.longTasks.length,
        maxLongTaskMs: Number(Math.max(0, ...raw.longTasks).toFixed(2)),
        zoomChanged: viewportPersistence.serialized !== viewportBeforeZoom,
        viewportPersisted: viewportPersistence.persisted,
        pageErrors,
    };

    await context.close();
    return result;
}

const vitePath = path.join(webDir, "node_modules", "vite", "bin", "vite.js");
const server = spawn(await findViteNode(), [vitePath, "--host", HOST, "--port", String(PORT), "--strictPort"], {
    cwd: webDir,
    env: { ...process.env, BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
});

let browser;
try {
    await waitForServer(server);
    browser = await chromium.launch({
        executablePath: await findChrome(),
        headless: true,
        args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
    });

    const results = [];
    for (const nodeCount of BENCHMARK_NODE_COUNTS) {
        results.push(await runCase(browser, nodeCount));
    }

    console.table(
        results.map(({ pageErrors, ...result }) => ({
            ...result,
            errors: pageErrors.length,
        })),
    );
    console.log(JSON.stringify({ nodeCounts: BENCHMARK_NODE_COUNTS, results }, null, 2));

    const failed = results.filter((result) => result.pageErrors.length || result.viewportUpdates < 10 || result.projectCommits >= result.viewportUpdates || !result.zoomChanged || !result.viewportPersisted);
    if (failed.length) {
        throw new Error(`视口隔离基准未通过：${failed.map((result) => `${result.nodes} 节点`).join("、")}`);
    }
} catch (error) {
    if (serverOutput.trim()) console.error(serverOutput.trim());
    throw error;
} finally {
    await browser?.close();
    server.kill("SIGTERM");
}
