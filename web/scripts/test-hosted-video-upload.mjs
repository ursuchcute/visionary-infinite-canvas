import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, loadConfigFromFile } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prefix = "/__dev/video-reference-upload";
const upstreamRequests = [];
const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    upstreamRequests.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.writeHead(200);
    res.end("uploaded");
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const original = process.env.VITE_VISIONARY_HOSTED;
let dev;
try {
    process.env.VITE_VISIONARY_HOSTED = "1";
    dev = await createServer({ root, configFile: path.join(root, "vite.config.ts"), logLevel: "silent", server: { host: "127.0.0.1", port: 0, strictPort: true } });
    const proxy = dev.config.server.proxy[prefix];
    assert.equal(proxy.target, "https://555acb10d58a7ff33a36dc527b319fb0.r2.cloudflarestorage.com");
    // Exercise the actual Vite middleware against a local fake R2, including
    // path rewriting, method admission and stripping main-site credentials.
    proxy.target = `http://127.0.0.1:${upstream.address().port}`;
    await dev.listen();
    const base = `http://127.0.0.1:${dev.httpServer.address().port}`;
    const remotePath = `/bucket/video-references/account/image.jpg?X-Amz-Signature=${"a".repeat(64)}&credential=encoded%2Fvalue`;
    const response = await fetch(`${base}${prefix}${remotePath}`, { method: "PUT", headers: { "Content-Type": "image/jpeg", Cookie: "test-session=private", Authorization: "Bearer private", Origin: "http://localhost:3002" }, body: "image" });
    assert.equal(response.status, 200);
    assert.equal(upstreamRequests[0].url, remotePath);
    assert.equal(upstreamRequests[0].body, "image");
    assert.equal(upstreamRequests[0].headers["content-type"], "image/jpeg");
    for (const header of ["cookie", "authorization", "origin"]) assert.equal(upstreamRequests[0].headers[header], undefined);
    assert.equal((await fetch(`${base}${prefix}${remotePath}`)).status, 404);
    assert.equal((await fetch(`${base}${prefix}/bucket/unrelated/file?X-Amz-Signature=${"a".repeat(64)}`, { method: "PUT", body: "image" })).status, 404);
    assert.equal((await fetch(`${base}${prefix}/bucket/video-references/account/image.jpg`, { method: "PUT", body: "image" })).status, 404);
    assert.equal(upstreamRequests.length, 1);
    process.env.VITE_VISIONARY_HOSTED = "0";
    const standalone = await loadConfigFromFile({ command: "serve", mode: "development" }, path.join(root, "vite.config.ts"));
    assert.equal(standalone.config.server.proxy[prefix], undefined);
    console.log("Hosted video local upload: 13 checks passed (actual Vite proxy; fixed origin, scoped PUT, no session credentials forwarded; standalone unchanged).");
} finally {
    if (dev) await dev.close();
    await new Promise((resolve) => upstream.close(resolve));
    if (original === undefined) delete process.env.VITE_VISIONARY_HOSTED;
    else process.env.VITE_VISIONARY_HOSTED = original;
}
