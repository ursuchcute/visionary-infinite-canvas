import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("../src/components/canvas/canvas-node.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("canvas-node.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
ts.forEachChild(ast, node => { if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast)); });
const compiled = ts.transpileModule(
    "const { React, useRef, useState, useEffect } = globalThis.__videoPlayerTests; export " + functions.get("HostedVideoPlayer") + " export " + functions.get("VideoNodeContent"),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } },
);
let slots, cursor, effects, initialized;
globalThis.__videoPlayerTests = {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat().filter(Boolean) } }) },
    useRef: initial => { const i = cursor++; return slots[i] ||= { current: initial }; },
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useEffect: run => { if (!initialized) effects.push(run); },
};
const api = await import("data:text/javascript;base64," + Buffer.from(compiled.outputText).toString("base64"));
let observer, disconnects = 0;
globalThis.IntersectionObserver = class {
    constructor(callback) { this.notify = callback; observer = this; }
    observe(node) { this.target = node; }
    disconnect() { disconnects++; }
};
const theme = { node: { placeholder: "gray", fill: "white", text: "black" } };
const sourceUrl = "/api/canvas/v1/videos/tasks/original-task/content";
const render = () => { cursor = 0; return api.HostedVideoPlayer({ source: sourceUrl, theme }); };
const mount = () => { slots = []; effects = []; initialized = false; const tree = render(); const element = {}; tree.props.children[0].props.ref.current = element; const cleanups = effects.map(run => run()); initialized = true; return { tree, element, cleanups }; };
const find = (tree, type) => tree.props.children.find(child => child.type === type);
const loading = tree => tree.props.children.some(child => child.props?.role === "status");
let checks = 0;
const check = run => { run(); checks++; };
let mounted = mount();
check(() => assert.equal(observer.target, mounted.element));
check(() => assert.equal(find(mounted.tree, "video").props.src, undefined));
observer.notify([{ isIntersecting: false }]);
check(() => assert.equal(find(render(), "video").props.src, undefined));
observer.notify([{ isIntersecting: true }]);
let tree = render(), video = find(tree, "video");
check(() => assert.equal(video.props.src, sourceUrl));
check(() => assert.equal(video.props.preload, "metadata"));
check(() => assert.equal(video.props.autoPlay, undefined));
check(() => assert.equal(loading(tree), true));
check(() => assert.equal(disconnects, 1));
video.props.onLoadedData();
check(() => assert.equal(loading(render()), false));
video.props.onError(); tree = render();
check(() => assert.equal(loading(tree), false));
const error = tree.props.children.find(child => child.props.children?.some(part => part?.props?.children?.includes("视频读取暂时失败，生成结果已保留")));
check(() => assert.ok(error));
let stopped = false;
find(error, "button").props.onClick({ stopPropagation: () => { stopped = true; } });
tree = render();
check(() => assert.equal(stopped, true));
check(() => assert.equal(find(tree, "video").props.src, sourceUrl));
check(() => assert.notEqual(find(tree, "video").props.key, video.props.key));
check(() => assert.equal(loading(tree), true));
check(() => assert.equal(tree.props.children.length, 2));
mounted.cleanups.forEach(run => run?.());
check(() => assert.equal(disconnects, 2));
const hostNode = content => api.VideoNodeContent({ node: { metadata: { content, hostVideoTaskId: "original-task" } }, theme });
check(() => assert.notEqual(hostNode(sourceUrl).props.key, hostNode(sourceUrl + "-new").props.key));
delete globalThis.IntersectionObserver;
mount();
check(() => assert.equal(find(render(), "video").props.src, sourceUrl));
check(() => assert.equal(loading(render()), true));
console.log(`Hosted video player: ${checks} assertions passed (viewport activation, preview, original-content retry, cleanup and source reset).`);
