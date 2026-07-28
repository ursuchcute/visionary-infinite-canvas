import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(path.join(webRoot, relativePath), "utf8");
const project = readSource("src/pages/canvas/project.tsx");
const references = readSource("src/lib/canvas/canvas-resource-references.ts");
const promptPanel = readSource("src/components/canvas/canvas-node-prompt-panel.tsx");
const imageReferenceAttachments = readSource("src/components/canvas/canvas-image-reference-attachments.tsx");
const generation = readSource("src/components/canvas/canvas-node-generation.ts");
const graphLayer = readSource("src/components/canvas/canvas-graph-layer.tsx");
const connectionLayer = readSource("src/components/canvas/canvas-connection-layer.tsx");

assert.match(references, /export function withConnectedNodeAutoMention/);
assert.match(references, /图片连接本身就是结构化引用/);
assert.match(references, /reference\.kind !== "text"/);
assert.match(references, /\$\{mention\} `/);

assert.match(project, /const nextConnections = \[\.\.\.connectionsRef\.current, nextConnection\];/);
assert.equal(project.match(/withConnectedNodeAutoMention\(/g)?.length, 2);
assert.match(project, /setConnections\(\(prev\) => \[\.\.\.prev, nextConnection\]\);/);

assert.match(promptPanel, /const mentionReferenceSignature = useMemo/);
assert.match(promptPanel, /\[mentionReferenceSignature, node\.id\]/);
assert.match(imageReferenceAttachments, /data-canvas-image-reference-strip/);
assert.match(imageReferenceAttachments, /移除参考图并断开连线/);
assert.match(imageReferenceAttachments, /group-hover:opacity-100/);
assert.match(imageReferenceAttachments, /reference\.nodeId !== targetNodeId/);
assert.match(promptPanel, /onReferenceRemove\?\.\(node\.id, reference\)/);
assert.match(project, /const removePromptReference = useCallback/);
assert.match(project, /const connectedConfigId = currentConnections\.find/);
assert.doesNotMatch(project, /const connectedConfigIds = new Set/);
assert.match(project, /connection\.toNodeId === connectedConfigId/);
assert.match(project, /const nextConnections = currentConnections\.filter\(\(connection\) => !removedConnectionIds\.has\(connection\.id\)\)/);
assert.match(project, /function reconcileNodeReferenceMentions/);
assert.match(project, /nodeIdAliases: ReadonlyMap<string, string>/);
assert.match(project, /const firstSourceByResolvedId = new Map<string, string>\(\)/);
assert.match(project, /firstSourceNodeId && firstSourceNodeId !== sourceNodeId/);
assert.match(project, /nextLabelByNodeId\.get\(nodeIdAliases\.get\(reference\.nodeId\) \|\| reference\.nodeId\)/);
assert.match(project, /const claimedNodeIds = new Set<string>\(\)/);
assert.match(project, /claimedNodeIds\.has\(rewrite\.resolvedNodeId\)/);
assert.match(project, /reconcileNodeReferenceMentions\(currentNodes, updatedNodes, currentConnections, nextConnections, undefined, promotedRootByChildId\)/);
assert.match(project, /setNodes\(reconcileNodeReferenceMentions\(nodesRef\.current, nodesRef\.current, currentConnections, nextConnections\)\)/);
assert.match(project, /const referenceImages = generationContext\.referenceImages\.length \? generationContext\.referenceImages : sourceReference/);

assert.match(generation, /const referenceImages = inputs\.map\(\(input\) => input\.image\)/);

assert.match(graphLayer, /selectedNodeIds: ReadonlySet<string>/);
assert.match(graphLayer, /selectedConnectionId: string \| null/);
assert.match(graphLayer, /activeConnectionIds: ReadonlySet<string>/);
assert.match(connectionLayer, /connection\.id === selectedConnectionId/);
assert.match(connectionLayer, /activeConnectionIds\.has\(connection\.id\)/);
assert.match(connectionLayer, /selectedNodeIds\.has\(connection\.fromNodeId\)/);
assert.match(connectionLayer, /selectedNodeIds\.has\(connection\.toNodeId\)/);
assert.match(project, /<CanvasGraphLayer[\s\S]*?selectedNodeIds=\{selectedNodeIds\}[\s\S]*?selectedConnectionId=\{selectedConnectionId\}[\s\S]*?activeConnectionIds=\{relatedHighlight\.connectionIds\}/);

console.log("Canvas reference connection contract passed.");
