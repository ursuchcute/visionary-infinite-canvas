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
        benchmarkWindow.__VCANVAS_BENCHMARK__ = { active: true, projectCommits: 0, graphCommits: 0 };
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
            graphCommits: benchmarkWindow.__VCANVAS_BENCHMARK__.graphCommits,
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
    const dragTarget = await page.evaluate(async (id) => {
        const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts");
        const renderedNodeIds = [...document.querySelectorAll("[data-node-id]")].map((element) => element.getAttribute("data-node-id"));
        const renderedConnectionIds = new Set([...document.querySelectorAll("[data-connection-id]")].map((element) => element.getAttribute("data-connection-id")));
        const connection = useCanvasStore
            .getState()
            .openProject(id)
            ?.connections.find((item) => renderedConnectionIds.has(item.id) && renderedNodeIds.includes(item.fromNodeId));
        return connection ? { connectionId: connection.id, nodeIndex: renderedNodeIds.indexOf(connection.fromNodeId) } : null;
    }, projectId);
    if (!dragTarget) throw new Error("找不到可用于拖拽回归的可见连线");
    const dragConnection = page.locator(`[data-connection-id="${dragTarget.connectionId}"]`);
    const connectionPathBeforeDrag = await dragConnection.getAttribute("d");
    const dragNode = page.locator("[data-node-id]").nth(dragTarget.nodeIndex);
    const dragNodeBox = await dragNode.boundingBox();
    if (!dragNodeBox) throw new Error("无法读取拖拽节点尺寸");
    const dragStartX = dragNodeBox.x + dragNodeBox.width / 2;
    const dragStartY = dragNodeBox.y + 5;
    await dragNode.evaluate(
        (element, point) => {
            const dragSurface = [...element.children].find((child) => child instanceof HTMLElement && child.classList.contains("h-full")) || element.firstElementChild;
            return dragSurface?.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: point.x, clientY: point.y, bubbles: true, cancelable: true })) ?? false;
        },
        { x: dragStartX, y: dragStartY },
    );
    await page.evaluate(
        (point) => {
            window.dispatchEvent(new MouseEvent("mousemove", { button: 0, buttons: 1, clientX: point.x + 80, clientY: point.y + 30, bubbles: true, cancelable: true }));
            window.dispatchEvent(new MouseEvent("mouseup", { button: 0, clientX: point.x + 80, clientY: point.y + 30, bubbles: true, cancelable: true }));
        },
        { x: dragStartX, y: dragStartY },
    );
    await page.waitForTimeout(100);
    const connectionFollowsDrag = (await dragConnection.getAttribute("d")) !== connectionPathBeforeDrag;

    const firstConnection = page.locator("[data-connection-id]").first();
    await firstConnection.evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    await page.waitForTimeout(50);
    const connectionSelectable = await firstConnection.evaluate((element) => element.nextElementSibling?.getAttribute("stroke-width") === "3");
    await firstConnection.evaluate((element) =>
        element.dispatchEvent(
            new MouseEvent("contextmenu", {
                clientX: 640,
                clientY: 420,
                button: 2,
                bubbles: true,
                cancelable: true,
            }),
        ),
    );
    const connectionContextMenu = await page.getByRole("button", { name: "删除", exact: true }).isVisible();

    const frameIntervals = raw.frameTimes.slice(1).map((time, index) => time - raw.frameTimes[index]);
    const result = {
        nodes: nodeCount,
        connections: nodeCount - 1,
        renderedNodes: raw.renderedNodes,
        renderedConnections: raw.renderedConnections,
        durationMs: Math.round(raw.duration),
        viewportUpdates: raw.viewportUpdates,
        projectCommits: raw.projectCommits,
        graphCommits: raw.graphCommits,
        commitIsolationRatio: raw.viewportUpdates ? Number((raw.projectCommits / raw.viewportUpdates).toFixed(3)) : 0,
        averageFps: raw.duration ? Number((((raw.frameTimes.length - 1) * 1000) / raw.duration).toFixed(1)) : 0,
        p95FrameMs: Number(percentile(frameIntervals, 0.95).toFixed(2)),
        framesOver25ms: frameIntervals.filter((value) => value > 25).length,
        longTasks: raw.longTasks.length,
        maxLongTaskMs: Number(Math.max(0, ...raw.longTasks).toFixed(2)),
        zoomChanged: viewportPersistence.serialized !== viewportBeforeZoom,
        viewportPersisted: viewportPersistence.persisted,
        connectionFollowsDrag,
        connectionSelectable,
        connectionContextMenu,
        pageErrors,
    };

    await context.close();
    return result;
}

async function runLongConnectionCullingCase(browser) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(`${BASE_URL}/canvas`, { waitUntil: "networkidle" });
    const seeded = await page.evaluate(async () => {
        const [{ useCanvasStore }, { createCanvasNode }, { CanvasNodeType }] = await Promise.all([import("/src/stores/canvas/use-canvas-store.ts"), import("/src/lib/canvas/canvas-node-factory.ts"), import("/src/types/canvas.ts")]);

        const hydrationDeadline = performance.now() + 10_000;
        while (!useCanvasStore.getState().hydrated) {
            if (performance.now() > hydrationDeadline) throw new Error("画布存储初始化超时");
            await new Promise((resolve) => setTimeout(resolve, 20));
        }

        const left = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 });
        const right = createCanvasNode(CanvasNodeType.Config, { x: 2500, y: 0 });
        const connection = {
            id: "long-connection-culling-regression",
            fromNodeId: left.id,
            toNodeId: right.id,
        };
        const projectId = useCanvasStore.getState().importProject({
            title: "Long Connection Culling Regression",
            nodes: [left, right],
            connections: [connection],
            viewport: { x: 200, y: 320, k: 0.45 },
        });
        return { projectId, rightNodeId: right.id, connectionId: connection.id };
    });

    await page.waitForTimeout(650);
    await page.goto(`${BASE_URL}/canvas/${seeded.projectId}`, { waitUntil: "networkidle" });
    const canvas = page.locator("[data-canvas-root]");
    await canvas.waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(300);

    const readRenderedState = () =>
        page.evaluate(
            ({ rightNodeId, connectionId }) => ({
                rightNodeMounted: Boolean(document.querySelector(`[data-node-id="${rightNodeId}"]`)),
                connectionMounted: Boolean(document.querySelector(`[data-connection-id="${connectionId}"]`)),
            }),
            seeded,
        );
    const samples = [await readRenderedState()];
    const box = await canvas.boundingBox();
    if (!box) throw new Error("无法读取长连线回归画布尺寸");
    const startX = box.x + box.width * 0.5;
    const startY = box.y + box.height * 0.52;
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: "middle" });
    for (let index = 1; index <= 9; index += 1) {
        await page.mouse.move(startX + index * 40, startY);
        await page.waitForTimeout(120);
        samples.push(await readRenderedState());
    }
    await page.mouse.up({ button: "middle" });
    await page.waitForTimeout(250);
    samples.push(await readRenderedState());

    const result = {
        sampleCount: samples.length,
        rightNodeRetained: samples.every((sample) => sample.rightNodeMounted),
        connectionRetained: samples.every((sample) => sample.connectionMounted),
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
    const longConnectionCulling = await runLongConnectionCullingCase(browser);

    console.table(
        results.map(({ pageErrors, ...result }) => ({
            ...result,
            errors: pageErrors.length,
        })),
    );
    console.log(JSON.stringify({ nodeCounts: BENCHMARK_NODE_COUNTS, results, longConnectionCulling }, null, 2));

    const failed = results.filter(
        (result) =>
            result.pageErrors.length ||
            result.viewportUpdates < 10 ||
            result.projectCommits >= result.viewportUpdates ||
            result.projectCommits >= result.graphCommits ||
            !result.zoomChanged ||
            !result.viewportPersisted ||
            !result.connectionFollowsDrag ||
            !result.connectionSelectable ||
            !result.connectionContextMenu ||
            result.renderedConnections >= result.connections,
    );
    if (failed.length) {
        throw new Error(`视口隔离基准未通过：${failed.map((result) => `${result.nodes} 节点`).join("、")}`);
    }
    if (longConnectionCulling.pageErrors.length || !longConnectionCulling.rightNodeRetained || !longConnectionCulling.connectionRetained) {
        throw new Error("长连线端点节点裁剪回归未通过");
    }
} catch (error) {
    if (serverOutput.trim()) console.error(serverOutput.trim());
    throw error;
} finally {
    await browser?.close();
    server.kill("SIGTERM");
    server.stdout.destroy();
    server.stderr.destroy();
    server.unref();
}
