#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { promises as dns } from "node:dns";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webRoot, "..");
const args = parseArgs(process.argv.slice(2));
const config = {
    host: args.host || process.env.CANVAS_DEPLOY_HOST || "root@visionary.beer",
    releaseRoot: normalizeRemotePath(args.releaseRoot || process.env.CANVAS_DEPLOY_RELEASES_DIR || "/opt/v-canvas-releases"),
    currentPath: normalizeRemotePath(args.currentPath || process.env.CANVAS_DEPLOY_CURRENT_DIR || "/opt/v-canvas"),
    publicUrl: normalizePublicUrl(args.publicUrl || process.env.CANVAS_DEPLOY_HEALTH_URL || "https://canvas.visionary.beer"),
    expectedIpv4: String(args.expectedIp || process.env.CANVAS_DEPLOY_EXPECTED_IP || "154.37.222.66").trim(),
};
assertIndependentRemotePaths(config.releaseRoot, config.currentPath);
const sshOptions = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4"];

if (args.help) {
    printHelp();
    process.exit(0);
}

await main();

async function main() {
    if (args.rollback) {
        switchToPreviousRelease();
        try {
            await smokePublicDeployment();
        } catch (error) {
            try {
                switchToPreviousRelease();
                console.error("Canvas rollback health check failed; restored the original active release.");
            } catch (restoreError) {
                console.error("Canvas rollback health check failed and the original release could not be restored:", restoreError);
            }
            throw error;
        }
        console.log(`Canvas rollback complete: ${config.publicUrl}`);
        return;
    }

    if (args.activate) {
        const releaseName = normalizeReleaseName(args.activate);
        const releaseDir = path.posix.join(config.releaseRoot, releaseName);
        await assertPublicDns();
        switchRelease(releaseDir);
        try {
            await smokePublicDeployment();
        } catch (error) {
            rollbackAfterFailedActivation(releaseDir);
            throw error;
        }
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

    run("npm", ["run", "typecheck"], webRoot);
    run("npm", ["run", "build:hosted"], webRoot, {
        VITE_VISIONARY_RELEASE_VERSION: version,
        VITE_VISIONARY_SOURCE_REVISION: revision,
    });
    run("npm", ["run", "audit:hosted"], webRoot, {
        VITE_VISIONARY_RELEASE_VERSION: version,
        VITE_VISIONARY_SOURCE_REVISION: revision,
    });

    const distDir = path.join(webRoot, "dist");
    if (!existsSync(path.join(distDir, "index.html"))) {
        throw new Error("Hosted build did not produce web/dist/index.html.");
    }
    writeFileSync(path.join(distDir, "visionary-release.json"), `${JSON.stringify({
        version,
        revision,
        builtAt: new Date().toISOString(),
        source: `https://github.com/ursuchcute/visionary-infinite-canvas/tree/${revision}`,
    }, null, 2)}\n`);

    remoteRun([
        "set -eu",
        `release=${shQuote(releaseDir)}`,
        `root=${shQuote(config.releaseRoot)}`,
        "mkdir -p \"$root\" \"$release\"",
        "test \"$(dirname \"$release\")\" = \"$root\"",
    ].join("\n"));
    run("rsync", [
        "-az",
        "--delete",
        "--chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r",
        `${distDir}/`,
        `${config.host}:${releaseDir}/`,
    ], repoRoot);
    remoteRun([
        "set -eu",
        `release=${shQuote(releaseDir)}`,
        "test -f \"$release/index.html\"",
        "test -f \"$release/visionary-release.json\"",
        "find \"$release\" -type d -exec chmod 755 {} +",
        "find \"$release\" -type f -exec chmod 644 {} +",
    ].join("\n"));

    if (args.stageOnly) {
        console.log(`Canvas release staged without activation: ${releaseDir}`);
        return;
    }

    await assertPublicDns();
    switchRelease(releaseDir);
    try {
        await smokePublicDeployment();
    } catch (error) {
        rollbackAfterFailedActivation(releaseDir);
        throw error;
    }
    console.log(`Canvas deploy complete: ${releaseDir}`);
}

function ensureCleanPushedRevision() {
    const status = runText("git", ["status", "--porcelain"], repoRoot);
    if (status) throw new Error("Commit all v-canvas changes before deploying.");
    const branch = runText("git", ["branch", "--show-current"], repoRoot);
    if (branch !== "main") throw new Error(`Canvas production deploy requires main; current branch is ${branch || "detached"}.`);
    const upstream = runText("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], repoRoot);
    const pushed = spawnSync("git", ["merge-base", "--is-ancestor", "HEAD", upstream], { cwd: repoRoot, stdio: "ignore" });
    if (pushed.status !== 0) throw new Error(`Push the current Canvas revision to ${upstream} before deploying.`);
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
    const pushedTag = spawnSync(
        "git",
        [
            "ls-remote",
            "--exit-code",
            "--tags",
            remote,
            `refs/tags/${exactTag}`,
            `refs/tags/${exactTag}^{}`,
        ],
        { cwd: repoRoot, encoding: "utf8" },
    );
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
    const remoteRevision = remoteRefs.get(`refs/tags/${exactTag}^{}`)
        || remoteRefs.get(`refs/tags/${exactTag}`);
    const localRevision = runText("git", ["rev-parse", "HEAD"], repoRoot);
    if (remoteRevision !== localRevision) {
        throw new Error(`Remote tag ${exactTag} does not point to the current Canvas revision.`);
    }
    return exactTag;
}

function switchRelease(releaseDir) {
    remoteRun([
        "set -eu",
        `release=${shQuote(releaseDir)}`,
        `current=${shQuote(config.currentPath)}`,
        "test -f \"$release/index.html\"",
        "test -f \"$release/visionary-release.json\"",
        "previous=$(readlink -f \"$current\" 2>/dev/null || true)",
        "if [ -n \"$previous\" ] && [ \"$previous\" != \"$release\" ]; then",
        "  ln -sfn \"$previous\" \"$current.previous.next\"",
        "  mv -Tf \"$current.previous.next\" \"$current.previous\"",
        "fi",
        "ln -sfn \"$release\" \"$current.next\"",
        "mv -Tf \"$current.next\" \"$current\"",
        "test \"$(readlink -f \"$current\")\" = \"$release\"",
    ].join("\n"));
}

function switchToPreviousRelease() {
    remoteRun([
        "set -eu",
        `current=${shQuote(config.currentPath)}`,
        "active=$(readlink -f \"$current\" 2>/dev/null || true)",
        "previous=$(readlink -f \"$current.previous\" 2>/dev/null || true)",
        "test -n \"$active\"",
        "test -f \"$previous/index.html\"",
        "test -f \"$previous/visionary-release.json\"",
        "ln -sfn \"$active\" \"$current.previous.next\"",
        "ln -sfn \"$previous\" \"$current.next\"",
        "mv -Tf \"$current.previous.next\" \"$current.previous\"",
        "mv -Tf \"$current.next\" \"$current\"",
    ].join("\n"));
}

function rollbackAfterFailedActivation(failedRelease) {
    try {
        remoteRun([
            "set -eu",
            `current=${shQuote(config.currentPath)}`,
            `failed=${shQuote(failedRelease)}`,
            "active=$(readlink -f \"$current\" 2>/dev/null || true)",
            "previous=$(readlink -f \"$current.previous\" 2>/dev/null || true)",
            "test \"$active\" = \"$failed\"",
            "if [ -n \"$previous\" ]; then",
            "  test -f \"$previous/index.html\"",
            "  test -f \"$previous/visionary-release.json\"",
            "  ln -sfn \"$active\" \"$current.previous.next\"",
            "  ln -sfn \"$previous\" \"$current.next\"",
            "  mv -Tf \"$current.previous.next\" \"$current.previous\"",
            "  mv -Tf \"$current.next\" \"$current\"",
            "else",
            "  rm -f \"$current\"",
            "fi",
        ].join("\n"));
        console.error("Canvas health check failed; restored the previous release state.");
    } catch (rollbackError) {
        console.error("Canvas health check failed and automatic rollback was unavailable:", rollbackError);
    }
}

async function assertPublicDns() {
    const hostname = new URL(config.publicUrl).hostname;
    const [addresses, ipv6Addresses] = await Promise.all([
        resolveDnsRecords(() => dns.resolve4(hostname)),
        resolveDnsRecords(() => dns.resolve6(hostname)),
    ]);
    const uniqueAddresses = [...new Set(addresses)];
    const uniqueIpv6Addresses = [...new Set(ipv6Addresses)];
    if (!uniqueAddresses.length) {
        throw new Error(`${hostname} has no A record. Use --stage-only until DNS and TLS are ready.`);
    }
    if (
        config.expectedIpv4
        && (uniqueAddresses.length !== 1 || uniqueAddresses[0] !== config.expectedIpv4)
    ) {
        throw new Error(
            `${hostname} must resolve only to the expected production IP ${config.expectedIpv4}; received ${uniqueAddresses.join(", ")}.`,
        );
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

async function smokePublicDeployment() {
    const headers = runText("curl", ["-fsS", "--max-time", "20", "-D", "-", "-o", "/dev/null", `${config.publicUrl}/`], repoRoot);
    if (!/content-security-policy:.*frame-ancestors https:\/\/visionary\.beer/im.test(headers)) {
        throw new Error("Canvas response is missing the required frame-ancestors CSP.");
    }
    const apiStatus = runText("curl", [
        "-sS",
        "--max-time",
        "20",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        `${config.publicUrl}/api/canvas/v1/bootstrap`,
    ], repoRoot);
    if (apiStatus !== "404") {
        throw new Error(`Unauthenticated Canvas bootstrap must be hidden with 404; received ${apiStatus}.`);
    }
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

function run(command, commandArgs, cwd, extraEnv = {}) {
    execFileSync(command, commandArgs, {
        cwd,
        stdio: "inherit",
        env: { ...process.env, ...extraEnv },
    });
}

function runText(command, commandArgs, cwd) {
    return execFileSync(command, commandArgs, { cwd, encoding: "utf8", env: process.env }).trim();
}

function requireNode22() {
    if (Number(process.versions.node.split(".")[0]) < 22) {
        throw new Error(`Hosted deploy requires Node.js 22 or newer; current version is ${process.versions.node}.`);
    }
}

function normalizeRemotePath(value) {
    const requested = String(value || "").trim().replace(/\/+$/, "");
    const normalized = path.posix.normalize(requested);
    const segments = normalized.split("/").filter(Boolean);
    if (
        requested !== normalized
        || !/^\/[A-Za-z0-9._/-]+$/.test(normalized)
        || normalized === "/"
        || segments.length < 2
        || segments.some((segment) => segment === "." || segment === "..")
        || !normalized.startsWith("/opt/")
    ) {
        throw new Error(`Unsafe remote deployment path: ${value}`);
    }
    return normalized;
}

function assertIndependentRemotePaths(releaseRoot, currentPath) {
    if (
        releaseRoot === currentPath
        || releaseRoot.startsWith(`${currentPath}/`)
        || currentPath.startsWith(`${releaseRoot}/`)
    ) {
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
    if (
        !/^[A-Za-z0-9._-]+$/.test(normalized)
        || normalized === "."
        || normalized === ".."
    ) {
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

The default command typechecks, builds, audits, uploads, atomically switches
/opt/v-canvas, and rolls back when public CSP/API smoke checks fail.`);
}
