#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const allowedAdvisory = "https://github.com/advisories/GHSA-qwww-vcr4-c8h2";
const allowedPackages = new Set(["react-router", "react-router-dom"]);
const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
});

if (result.error) throw result.error;

let report;
try {
    report = JSON.parse(String(result.stdout || ""));
} catch {
    process.stderr.write(String(result.stderr || result.stdout || "npm audit did not return valid JSON.\n"));
    process.exit(1);
}

if (report?.error || !report?.metadata?.vulnerabilities || typeof report.vulnerabilities !== "object") {
    process.stderr.write(`${String(result.stderr || "").trim()}\n${JSON.stringify(report?.error || report || { error: "npm audit returned an incomplete report." }, null, 2)}\n`);
    process.exit(1);
}

const unexpected = [];
for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities || {})) {
    const via = Array.isArray(vulnerability?.via) ? vulnerability.via : [];
    const isAllowedRouterFinding =
        allowedPackages.has(packageName) &&
        via.length > 0 &&
        via.every((item) => {
            if (typeof item === "string") return item === "react-router";
            return item?.url === allowedAdvisory;
        });
    if (!isAllowedRouterFinding) {
        unexpected.push(`${packageName}: ${vulnerability?.severity || "unknown"}`);
    }
}

if (unexpected.length) {
    console.error(`Hosted dependency audit found unapproved vulnerabilities:\n- ${unexpected.join("\n- ")}`);
    process.exit(1);
}

console.log("Hosted dependency audit passed. The only accepted advisory is React Router RSC mode GHSA-qwww-vcr4-c8h2; this static SPA does not enable an RSC server.");
