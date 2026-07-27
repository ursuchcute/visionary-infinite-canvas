#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { promises as dns } from "node:dns";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CURRENT_HOSTED_BUILD_METADATA_VERSION, hostedBuildMetadataVersion, requiresCurrentHostedContract } from "./hosted-release-contract.mjs";
import { assertCanvasCspHeaders } from "./hosted-csp-contract.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webRoot, "..");
const productionReleaseRoot = "/opt/v-canvas-releases";
const productionCurrentPath = "/opt/v-canvas";
const productionBase = "/";
const productionParentOrigin = "https://visionary.beer";
const args = parseArgs(process.argv.slice(2));
const config = {
    host: args.host || process.env.CANVAS_DEPLOY_HOST || "root@visionary.beer",
    releaseRoot: normalizeRemotePath(args.releaseRoot || process.env.CANVAS_DEPLOY_RELEASES_DIR || productionReleaseRoot),
    currentPath: normalizeRemotePath(args.currentPath || process.env.CANVAS_DEPLOY_CURRENT_DIR || productionCurrentPath),
    publicUrl: normalizePublicUrl(args.publicUrl || process.env.CANVAS_DEPLOY_HEALTH_URL || "https://canvas.visionary.beer"),
    expectedIpv4: String(args.expectedIp || process.env.CANVAS_DEPLOY_EXPECTED_IP || "154.37.222.66").trim(),
};
assertProductionCanvasRemotePaths(config.releaseRoot, config.currentPath);
assertIndependentRemotePaths(config.releaseRoot, config.currentPath);
const sshOptions = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4"];

if (args.help) {
    printHelp();
    process.exit(0);
}

await main();

async function main() {
    if (args.rollback) {
        await withRemoteDeployLock(async (assertLockHeld) => {
            const originalState = readRemoteReleaseState();
            if (!originalState.previous) {
                throw new Error("Canvas rollback is unavailable because no previous release is recorded.");
            }
            const rollbackManifest = readRemoteReleaseManifest(originalState.previous);
            await assertPublicDns();
            if (requiresCurrentHostedContract(rollbackManifest)) assertPublicCspPrecondition();
            try {
                switchToPreviousRelease();
                await smokePublicDeployment(rollbackManifest);
                assertLockHeld();
            } catch (error) {
                try {
                    restoreRemoteReleaseState(originalState, originalState.previous);
                    console.error("Canvas rollback health check failed; restored the original active release.");
                } catch (restoreError) {
                    console.error("Canvas rollback health check failed and the original release could not be restored:", restoreError);
                }
                throw error;
            }
        });
        console.log(`Canvas rollback complete: ${config.publicUrl}`);
        return;
    }

    if (args.activate) {
        const releaseName = normalizeReleaseName(args.activate);
        const releaseDir = path.posix.join(config.releaseRoot, releaseName);
        await withRemoteDeployLock(async (assertLockHeld) => {
            const releaseManifest = readRemoteReleaseManifest(releaseDir);
            await assertPublicDns();
            if (requiresCurrentHostedContract(releaseManifest)) assertPublicCspPrecondition();
            const originalState = readRemoteReleaseState();
            try {
                switchRelease(releaseDir);
                await smokePublicDeployment(releaseManifest);
                assertLockHeld();
            } catch (error) {
                restoreAfterFailedActivation(originalState, releaseDir);
                throw error;
            }
        });
        console.log(`Canvas release activated: ${releaseDir}`);
        return;
    }

    requireNode22();
    ensureCleanPushedRevision();
    const revision = runText("git", ["rev-parse", "HEAD"], repoRoot);
    const shortRevision = revision.slice(0, 12);
    const version = requirePushedReleaseTag();
    const releaseName = `${formatTimestamp(new Date())}-${shortRevision}`;
    const releaseDir = path.posix.join(config.releaseRoot, releaseName);

    run("npm", ["ci", "--include=dev", "--no-audit", "--no-fund"], webRoot);
    run("npm", ["run", "audit:hosted:dependencies"], webRoot);
    run("npm", ["run", "typecheck"], webRoot);
    run("npm", ["run", "test:release"], webRoot);
    const hostedBuildEnvironment = {
        VITE_BASE: productionBase,
        VITE_VISIONARY_HOSTED: "1",
        VITE_VISIONARY_PARENT_ORIGIN: productionParentOrigin,
        VITE_VISIONARY_RELEASE_VERSION: version,
        VITE_VISIONARY_SOURCE_REVISION: revision,
    };
    runWithSanitizedViteEnvironment("npm", ["run", "build:hosted"], webRoot, hostedBuildEnvironment);
    runWithSanitizedViteEnvironment("npm", ["run", "audit:hosted"], webRoot, hostedBuildEnvironment);

    const distDir = path.join(webRoot, "dist");
    if (!existsSync(path.join(distDir, "index.html"))) {
        throw new Error("Hosted build did not produce web/dist/index.html.");
    }
    const releaseManifest = {
        buildMetadataVersion: CURRENT_HOSTED_BUILD_METADATA_VERSION,
        version,
        revision,
        builtAt: new Date().toISOString(),
        source: `https://github.com/ursuchcute/visionary-infinite-canvas/tree/${revision}`,
    };
    writeFileSync(path.join(distDir, "visionary-release.json"), `${JSON.stringify(releaseManifest, null, 2)}\n`);

    remoteRun(
        [
            "set -eu",
            `release=${shQuote(releaseDir)}`,
            `root=${shQuote(config.releaseRoot)}`,
            'mkdir -p "$root"',
            'test -d "$root"',
            'test ! -L "$root"',
            'test "$(readlink -f "$root")" = "$root"',
            'test "$(dirname "$release")" = "$root"',
            'test ! -e "$release"',
            'mkdir "$release"',
        ].join("\n"),
    );
    run("rsync", ["-az", "--delete", "--chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r", `${distDir}/`, `${config.host}:${releaseDir}/`], repoRoot);
    remoteRun(["set -eu", `release=${shQuote(releaseDir)}`, 'test -f "$release/index.html"', 'test -f "$release/visionary-release.json"', 'find "$release" -type d -exec chmod 755 {} +', 'find "$release" -type f -exec chmod 644 {} +'].join("\n"));

    if (args.stageOnly) {
        console.log(`Canvas release staged without activation: ${releaseDir}`);
        return;
    }

    await withRemoteDeployLock(async (assertLockHeld) => {
        await assertPublicDns();
        assertPublicCspPrecondition();
        const originalState = readRemoteReleaseState();
        try {
            switchRelease(releaseDir);
            await smokePublicDeployment(releaseManifest);
            assertLockHeld();
        } catch (error) {
            restoreAfterFailedActivation(originalState, releaseDir);
            throw error;
        }
    });
    console.log(`Canvas deploy complete: ${releaseDir}`);
}

function ensureCleanPushedRevision() {
    const status = runText("git", ["status", "--porcelain"], repoRoot);
    if (status) throw new Error("Commit all v-canvas changes before deploying.");
    const branch = runText("git", ["branch", "--show-current"], repoRoot);
    if (branch !== "main") throw new Error(`Canvas production deploy requires main; current branch is ${branch || "detached"}.`);
    const remote = runText("git", ["config", `branch.${branch}.remote`], repoRoot);
    const mergeRef = runText("git", ["config", `branch.${branch}.merge`], repoRoot);
    const remoteHead = spawnSync("git", ["ls-remote", "--exit-code", "--heads", remote, mergeRef], {
        cwd: repoRoot,
        encoding: "utf8",
    });
    if (remoteHead.status !== 0) throw new Error(`Unable to verify ${remote} ${mergeRef} before deploying.`);
    const remoteRevision = String(remoteHead.stdout || "")
        .trim()
        .split(/\s+/, 1)[0];
    const localRevision = runText("git", ["rev-parse", "HEAD"], repoRoot);
    if (!remoteRevision || remoteRevision !== localRevision) {
        throw new Error(`Canvas deploy requires local HEAD ${localRevision} to exactly match ${remote} ${mergeRef} (${remoteRevision || "missing"}).`);
    }
}

function requirePushedReleaseTag() {
    const version = runText("git", ["show", "HEAD:VERSION"], repoRoot);
    const result = spawnSync("git", ["describe", "--tags", "--exact-match", "HEAD"], {
        cwd: repoRoot,
        encoding: "utf8",
    });
    const exactTag = result.status === 0 ? result.stdout.trim() : "";
    if (!exactTag) {
        throw new Error(`Tag the final Canvas commit as ${version} before deploying.`);
    }
    if (exactTag !== version) {
        throw new Error(`Canvas VERSION is ${version}, but HEAD is tagged ${exactTag}.`);
    }

    const branch = runText("git", ["branch", "--show-current"], repoRoot);
    const remote = runText("git", ["config", `branch.${branch}.remote`], repoRoot);
    const pushedTag = spawnSync("git", ["ls-remote", "--exit-code", "--tags", remote, `refs/tags/${exactTag}`, `refs/tags/${exactTag}^{}`], { cwd: repoRoot, encoding: "utf8" });
    if (pushedTag.status !== 0) {
        throw new Error(`Push the ${exactTag} tag to ${remote} before deploying.`);
    }
    const remoteRefs = new Map(
        String(pushedTag.stdout || "")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => {
                const [revision, ref] = line.trim().split(/\s+/, 2);
                return [ref, revision];
            }),
    );
    const remoteRevision = remoteRefs.get(`refs/tags/${exactTag}^{}`) || remoteRefs.get(`refs/tags/${exactTag}`);
    const localRevision = runText("git", ["rev-parse", "HEAD"], repoRoot);
    if (remoteRevision !== localRevision) {
        throw new Error(`Remote tag ${exactTag} does not point to the current Canvas revision.`);
    }
    return exactTag;
}

function switchRelease(releaseDir) {
    remoteRun(
        [
            "set -eu",
            `release=${shQuote(releaseDir)}`,
            `current=${shQuote(config.currentPath)}`,
            'test -f "$release/index.html"',
            'test -f "$release/visionary-release.json"',
            'previous=$(readlink -f "$current" 2>/dev/null || true)',
            'if [ -n "$previous" ] && [ "$previous" != "$release" ]; then',
            '  ln -sfn "$previous" "$current.previous.next"',
            '  mv -Tf "$current.previous.next" "$current.previous"',
            "fi",
            'ln -sfn "$release" "$current.next"',
            'mv -Tf "$current.next" "$current"',
            'test "$(readlink -f "$current")" = "$release"',
        ].join("\n"),
    );
}

function switchToPreviousRelease() {
    remoteRun(
        [
            "set -eu",
            `current=${shQuote(config.currentPath)}`,
            'active=$(readlink -f "$current" 2>/dev/null || true)',
            'previous=$(readlink -f "$current.previous" 2>/dev/null || true)',
            'test -n "$active"',
            'test -f "$previous/index.html"',
            'test -f "$previous/visionary-release.json"',
            'ln -sfn "$active" "$current.previous.next"',
            'ln -sfn "$previous" "$current.next"',
            'mv -Tf "$current.previous.next" "$current.previous"',
            'mv -Tf "$current.next" "$current"',
        ].join("\n"),
    );
}

function readRemoteReleaseState() {
    const output = remoteText(
        ["set -eu", `current=${shQuote(config.currentPath)}`, 'active=$(readlink -f "$current" 2>/dev/null || true)', 'previous=$(readlink -f "$current.previous" 2>/dev/null || true)', 'printf "active=%s\\nprevious=%s\\n" "$active" "$previous"'].join(
            "\n",
        ),
    );
    const values = new Map(
        output
            .split("\n")
            .map((line) => line.split("=", 2))
            .filter(([key]) => key === "active" || key === "previous"),
    );
    return {
        active: normalizeRemoteReleaseTarget(values.get("active") || "", "active"),
        previous: normalizeRemoteReleaseTarget(values.get("previous") || "", "previous"),
    };
}

function restoreRemoteReleaseState(state, expectedActive) {
    remoteRun(
        [
            "set -eu",
            `current=${shQuote(config.currentPath)}`,
            `active=${shQuote(state.active)}`,
            `previous=${shQuote(state.previous)}`,
            `expected_active=${shQuote(expectedActive)}`,
            'actual_active=$(readlink -f "$current" 2>/dev/null || true)',
            'test "$actual_active" = "$expected_active"',
            'if [ -n "$active" ]; then',
            '  test -f "$active/index.html"',
            '  test -f "$active/visionary-release.json"',
            '  ln -sfn "$active" "$current.restore.next"',
            '  mv -Tf "$current.restore.next" "$current"',
            "else",
            '  rm -f "$current"',
            "fi",
            'if [ -n "$previous" ]; then',
            '  test -f "$previous/index.html"',
            '  test -f "$previous/visionary-release.json"',
            '  ln -sfn "$previous" "$current.previous.restore.next"',
            '  mv -Tf "$current.previous.restore.next" "$current.previous"',
            "else",
            '  rm -f "$current.previous"',
            "fi",
        ].join("\n"),
    );
}

function restoreAfterFailedActivation(originalState, expectedActive) {
    try {
        restoreRemoteReleaseState(originalState, expectedActive);
        console.error("Canvas health check failed; restored the original active and previous releases.");
    } catch (rollbackError) {
        console.error("Canvas health check failed and automatic rollback was unavailable:", rollbackError);
    }
}

async function assertPublicDns() {
    const hostname = new URL(config.publicUrl).hostname;
    const [addresses, ipv6Addresses] = await Promise.all([resolveDnsRecords(() => dns.resolve4(hostname)), resolveDnsRecords(() => dns.resolve6(hostname))]);
    const uniqueAddresses = [...new Set(addresses)];
    const uniqueIpv6Addresses = [...new Set(ipv6Addresses)];
    if (!uniqueAddresses.length) {
        throw new Error(`${hostname} has no A record. Use --stage-only until DNS and TLS are ready.`);
    }
    if (config.expectedIpv4 && (uniqueAddresses.length !== 1 || uniqueAddresses[0] !== config.expectedIpv4)) {
        throw new Error(`${hostname} must resolve only to the expected production IP ${config.expectedIpv4}; received ${uniqueAddresses.join(", ")}.`);
    }
    if (uniqueIpv6Addresses.length) {
        throw new Error(`${hostname} has unexpected AAAA records (${uniqueIpv6Addresses.join(", ")}). Remove them before activation.`);
    }
    console.log(`Canvas DNS: ${hostname} -> ${uniqueAddresses.join(", ")}`);
}

async function resolveDnsRecords(resolve) {
    try {
        return await resolve();
    } catch (error) {
        if (error?.code === "ENODATA" || error?.code === "ENOTFOUND") {
            return [];
        }
        throw error;
    }
}

async function smokePublicDeployment(expectedManifest) {
    const headers = runText("curl", ["-fsS", "--max-time", "20", "-D", "-", "-o", "/dev/null", `${config.publicUrl}/`], repoRoot);
    try {
        assertCanvasCspHeaders(headers, { requireBlob: requiresCurrentHostedContract(expectedManifest) });
    } catch (error) {
        if (requiresCurrentHostedContract(expectedManifest) && error instanceof Error && error.message.includes("connect-src")) {
            throw new Error(`${error.message} Install ops/nginx/visionary-canvas-security-headers.conf, run nginx -t, and reload Nginx before activation.`);
        }
        throw error;
    }
    assertCanvasApiReadiness();
    const publicIndex = runText("curl", ["-fsS", "--max-time", "20", "-H", "Cache-Control: no-cache", `${config.publicUrl}/?verify=${Date.now()}`], repoRoot);
    assertPublicBuildMetadata(publicIndex, expectedManifest);
    const entryScriptUrl = findPublicEntryScript(publicIndex);
    const entryHeaders = runText("curl", ["-fsS", "--max-time", "20", "-D", "-", "-o", "/dev/null", entryScriptUrl], repoRoot);
    if (!/content-type:\s*(?:application|text)\/javascript\b/im.test(entryHeaders)) {
        throw new Error(`Canvas public entry script has an unexpected Content-Type: ${entryScriptUrl}.`);
    }
    const entryScript = runText("curl", ["-fsS", "--max-time", "20", "-H", "Cache-Control: no-cache", entryScriptUrl], repoRoot);
    if (requiresCurrentHostedContract(expectedManifest) && !entryScript.includes(productionParentOrigin)) {
        throw new Error("Canvas public entry script does not contain the production parent origin.");
    }
    const publicManifest = parseReleaseManifest(runText("curl", ["-fsS", "--max-time", "20", "-H", "Cache-Control: no-cache", `${config.publicUrl}/visionary-release.json?verify=${Date.now()}`], repoRoot), "public deployment");
    if (expectedManifest && (publicManifest.version !== expectedManifest.version || publicManifest.revision !== expectedManifest.revision || hostedBuildMetadataVersion(publicManifest) !== hostedBuildMetadataVersion(expectedManifest))) {
        throw new Error(`Canvas public manifest mismatch: expected ${expectedManifest.version}@${expectedManifest.revision}, received ${publicManifest.version}@${publicManifest.revision}.`);
    }
}

function assertPublicBuildMetadata(indexHtml, expectedManifest) {
    if (!requiresCurrentHostedContract(expectedManifest)) return;
    const expected = new Map([
        ["visionary-release-version", expectedManifest.version],
        ["visionary-source-revision", expectedManifest.revision],
        ["visionary-parent-origin", productionParentOrigin],
        ["visionary-public-base", productionBase],
    ]);
    for (const [name, value] of expected) {
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = new RegExp(`<meta\\s+name=["']${escapedName}["']\\s+content=["']([^"']*)["']\\s*\\/?>`, "i").exec(indexHtml);
        if (match?.[1] !== value) {
            throw new Error(`Canvas public build metadata mismatch for ${name}.`);
        }
    }
}

function assertCanvasApiReadiness() {
    const status = runText("curl", ["-sS", "--max-time", "20", "-o", "/dev/null", "-w", "%{http_code}", `${config.publicUrl}/api/canvas/v1/readiness`], repoRoot);
    if (status !== "204") {
        throw new Error(`Canvas API readiness check failed with status ${status || "unknown"}.`);
    }
}

function findPublicEntryScript(indexHtml) {
    const match = /<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["']([^"']+)["'][^>]*>/i.exec(indexHtml) || /<script\b[^>]*\bsrc=["']([^"']*\/assets\/[^"']+\.js(?:\?[^"']*)?)["'][^>]*>/i.exec(indexHtml);
    if (!match) throw new Error("Canvas public index does not reference an entry script.");
    const url = new URL(match[1], `${config.publicUrl}/`);
    if (url.origin !== new URL(config.publicUrl).origin) {
        throw new Error(`Canvas public index references a cross-origin entry script: ${url.toString()}`);
    }
    url.searchParams.set("verify", String(Date.now()));
    return url.toString();
}

function assertPublicCspPrecondition() {
    const headers = runText("curl", ["-sS", "--max-time", "20", "-D", "-", "-o", "/dev/null", `${config.publicUrl}/`], repoRoot);
    try {
        assertCanvasCspHeaders(headers, { requireBlob: true });
    } catch (error) {
        throw new Error(
            `Live Canvas CSP is not ready for image processing: ${error instanceof Error ? error.message : "invalid policy"} Install ops/nginx/visionary-canvas-security-headers.conf, run nginx -t, and reload Nginx before activating this release.`,
        );
    }
}

function readRemoteReleaseManifest(releaseDir) {
    const output = remoteText(["set -eu", `release=${shQuote(releaseDir)}`, 'test -f "$release/visionary-release.json"', 'cat "$release/visionary-release.json"'].join("\n"));
    return parseReleaseManifest(output, releaseDir);
}

function parseReleaseManifest(value, source) {
    let manifest;
    try {
        manifest = JSON.parse(String(value || ""));
    } catch {
        throw new Error(`Canvas release manifest is invalid JSON: ${source}.`);
    }
    if (!manifest || typeof manifest !== "object" || typeof manifest.version !== "string" || !manifest.version.trim() || typeof manifest.revision !== "string" || !/^[0-9a-f]{40}$/i.test(manifest.revision)) {
        throw new Error(`Canvas release manifest is missing a valid version or revision: ${source}.`);
    }
    if (Number.isNaN(hostedBuildMetadataVersion(manifest))) {
        throw new Error(`Canvas release manifest has an invalid build metadata version: ${source}.`);
    }
    return manifest;
}

async function withRemoteDeployLock(callback) {
    const lock = await acquireRemoteDeployLock();
    try {
        lock.assertHeld();
        const result = await callback(lock.assertHeld);
        lock.assertHeld();
        return result;
    } finally {
        await lock.release();
    }
}

function acquireRemoteDeployLock() {
    const marker = `__VISIONARY_CANVAS_DEPLOY_LOCKED_${process.pid}_${Date.now()}__`;
    const lockFile = path.posix.join(config.releaseRoot, ".visionary-canvas-deploy.lock");
    const script = [
        "set -eu",
        `root=${shQuote(config.releaseRoot)}`,
        `lock_file=${shQuote(lockFile)}`,
        'mkdir -p "$root"',
        'test -d "$root"',
        'test ! -L "$root"',
        'test "$(readlink -f "$root")" = "$root"',
        "command -v flock >/dev/null",
        'exec 9>"$lock_file"',
        'if ! flock -n 9; then echo "Another Canvas activation or rollback is already running." >&2; exit 73; fi',
        `printf '%s\\n' ${shQuote(marker)}`,
        "cat >/dev/null",
    ].join("\n");
    const child = spawn("ssh", [...sshOptions, config.host, "bash", "-lc", shQuote(script)], {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "inherit"],
    });
    child.stdin.on("error", () => undefined);
    child.stdout.setEncoding("utf8");

    return new Promise((resolve, reject) => {
        let output = "";
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill();
            reject(new Error("Timed out while acquiring the remote Canvas deployment lock."));
        }, 20_000);
        const fail = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(error);
        };
        child.on("error", fail);
        child.on("exit", (code) => {
            if (!settled) fail(new Error(`Unable to acquire the remote Canvas deployment lock (exit ${code ?? "unknown"}).`));
        });
        child.stdout.on("data", (chunk) => {
            if (settled) return;
            output += chunk;
            if (!output.includes(marker)) return;
            settled = true;
            clearTimeout(timeout);
            resolve({
                assertHeld() {
                    if (child.exitCode !== null || child.signalCode !== null) {
                        throw new Error("The remote Canvas deployment lock was lost before activation completed.");
                    }
                },
                async release() {
                    if (child.exitCode !== null || child.signalCode !== null) return;
                    child.stdin.end();
                    await new Promise((releaseResolve) => {
                        const releaseTimeout = setTimeout(() => {
                            child.kill();
                            releaseResolve();
                        }, 10_000);
                        child.once("exit", () => {
                            clearTimeout(releaseTimeout);
                            releaseResolve();
                        });
                    });
                },
            });
        });
    });
}

function remoteRun(script) {
    const result = spawnSync("ssh", [...sshOptions, config.host, "bash", "-se"], {
        cwd: repoRoot,
        input: script,
        encoding: "utf8",
        stdio: ["pipe", "inherit", "inherit"],
    });
    if (result.status !== 0) throw new Error(`Remote Canvas command failed with exit code ${result.status}.`);
}

function remoteText(script) {
    const result = spawnSync("ssh", [...sshOptions, config.host, "bash", "-se"], {
        cwd: repoRoot,
        input: script,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "inherit"],
    });
    if (result.status !== 0) throw new Error(`Remote Canvas command failed with exit code ${result.status}.`);
    return String(result.stdout || "").trim();
}

function run(command, commandArgs, cwd, extraEnv = {}) {
    execFileSync(command, commandArgs, {
        cwd,
        stdio: "inherit",
        env: { ...process.env, ...extraEnv },
    });
}

function runWithSanitizedViteEnvironment(command, commandArgs, cwd, extraEnv) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("VITE_")));
    execFileSync(command, commandArgs, {
        cwd,
        stdio: "inherit",
        env: { ...env, ...extraEnv },
    });
}

function runText(command, commandArgs, cwd) {
    return execFileSync(command, commandArgs, {
        cwd,
        encoding: "utf8",
        env: process.env,
        maxBuffer: 16 * 1024 * 1024,
    }).trim();
}

function requireNode22() {
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 12)) {
        throw new Error(`Hosted deploy requires Node.js 22.12 or newer; current version is ${process.versions.node}.`);
    }
}

function normalizeRemotePath(value) {
    const requested = String(value || "")
        .trim()
        .replace(/\/+$/, "");
    const normalized = path.posix.normalize(requested);
    const segments = normalized.split("/").filter(Boolean);
    if (requested !== normalized || !/^\/[A-Za-z0-9._/-]+$/.test(normalized) || normalized === "/" || segments.length < 2 || segments.some((segment) => segment === "." || segment === "..") || !normalized.startsWith("/opt/")) {
        throw new Error(`Unsafe remote deployment path: ${value}`);
    }
    return normalized;
}

function normalizeRemoteReleaseTarget(value, label) {
    if (!value) return "";
    const normalized = normalizeRemotePath(value);
    if (path.posix.dirname(normalized) !== config.releaseRoot) {
        throw new Error(`Canvas ${label} release points outside ${config.releaseRoot}: ${value}`);
    }
    return normalized;
}

function assertProductionCanvasRemotePaths(releaseRoot, currentPath) {
    if (releaseRoot !== productionReleaseRoot || currentPath !== productionCurrentPath) {
        throw new Error(`Canvas production deploy paths are fixed to ${productionReleaseRoot} and ${productionCurrentPath}; refusing an override that could touch another application.`);
    }
}

function assertIndependentRemotePaths(releaseRoot, currentPath) {
    if (releaseRoot === currentPath || releaseRoot.startsWith(`${currentPath}/`) || currentPath.startsWith(`${releaseRoot}/`)) {
        throw new Error("Canvas release root and current symlink path must be separate.");
    }
}

function normalizePublicUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw new Error(`Invalid Canvas public URL: ${value}`);
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
}

function normalizeReleaseName(value) {
    const normalized = String(value || "").trim();
    if (!/^[A-Za-z0-9._-]+$/.test(normalized) || normalized === "." || normalized === "..") {
        throw new Error(`Invalid Canvas release name: ${value}`);
    }
    return normalized;
}

function formatTimestamp(date) {
    const part = (value) => String(value).padStart(2, "0");
    return `${date.getUTCFullYear()}${part(date.getUTCMonth() + 1)}${part(date.getUTCDate())}${part(date.getUTCHours())}${part(date.getUTCMinutes())}${part(date.getUTCSeconds())}`;
}

function shQuote(value) {
    return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function parseArgs(values) {
    const parsed = { stageOnly: false, rollback: false, help: false };
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        const next = () => {
            index += 1;
            if (!values[index]) throw new Error(`Missing value after ${value}`);
            return values[index];
        };
        if (value === "--stage-only") parsed.stageOnly = true;
        else if (value === "--rollback") parsed.rollback = true;
        else if (value === "--activate") parsed.activate = next();
        else if (value === "--host") parsed.host = next();
        else if (value === "--release-root") parsed.releaseRoot = next();
        else if (value === "--current-path") parsed.currentPath = next();
        else if (value === "--public-url") parsed.publicUrl = next();
        else if (value === "--expected-ip") parsed.expectedIp = next();
        else if (value === "--help" || value === "-h") parsed.help = true;
        else throw new Error(`Unknown option: ${value}`);
    }
    const modes = Number(parsed.stageOnly) + Number(parsed.rollback) + Number(Boolean(parsed.activate));
    if (modes > 1) throw new Error("Use only one of --stage-only, --activate, or --rollback.");
    return parsed;
}

function printHelp() {
    console.log(`Visionary Hosted Canvas deploy

Usage:
  npm run deploy:hosted
  npm run deploy:hosted -- --stage-only
  npm run deploy:hosted -- --activate <release-name>
  npm run deploy:hosted -- --rollback

The default command clean-installs dependencies, tests, typechecks, builds, audits, uploads, atomically switches
/opt/v-canvas, and rolls back when public CSP/API smoke checks fail.`);
}
