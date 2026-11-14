#!/usr/bin/env node
// Downloads a pinned Bun binary for the current platform into vendor/bun/.
// electron-builder ships that folder as resources/bun/, and the app uses it to
// compile the standalone CLI export, so users never need Bun installed.
//
// Usage: node scripts/fetch-bun.mjs [--force]

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Bump deliberately; every installer ships exactly this version.
const BUN_VERSION = "1.2.19";

// x64 uses the "baseline" builds so the app (and the CLIs it compiles) also run
// on older CPUs without AVX2.
const TARGETS = {
	"linux-x64":    "bun-linux-x64-baseline",
	"linux-arm64":  "bun-linux-aarch64",
	"darwin-x64":   "bun-darwin-x64-baseline",
	"darwin-arm64": "bun-darwin-aarch64",
	"win32-x64":    "bun-windows-x64-baseline",
};

const root    = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir  = join(root, "vendor", "bun");
const isWin   = process.platform === "win32";
const outBin  = join(outDir, isWin ? "bun.exe" : "bun");
const stamp   = join(outDir, "VERSION");
const force   = process.argv.includes("--force");

const key    = `${process.platform}-${process.arch}`;
const target = TARGETS[key];
if (!target) {
	console.error(`fetch-bun: unsupported platform ${key}`);
	process.exit(1);
}

if (!force && existsSync(outBin) && existsSync(stamp) &&
	readFileSync(stamp, "utf8").trim() === `${BUN_VERSION} ${target}`) {
	console.log(`fetch-bun: Bun ${BUN_VERSION} (${target}) already present`);
	process.exit(0);
}

const base = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}`;
const zipName = `${target}.zip`;

async function download(url) {
	const res = await fetch(url, { headers: { "User-Agent": "nab-build" } });
	if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
	return Buffer.from(await res.arrayBuffer());
}

console.log(`fetch-bun: downloading Bun ${BUN_VERSION} (${target})...`);
const [zip, sums] = await Promise.all([
	download(`${base}/${zipName}`),
	download(`${base}/SHASUMS256.txt`).then(b => b.toString("utf8")),
]);

const expected = sums.split("\n")
	.map(line => line.trim().split(/\s+/))
	.find(([, name]) => name === zipName)?.[0];
if (!expected) throw new Error(`fetch-bun: ${zipName} missing from SHASUMS256.txt`);
const actual = createHash("sha256").update(zip).digest("hex");
if (actual !== expected) throw new Error(`fetch-bun: checksum mismatch for ${zipName}`);

const work = mkdtempSync(join(tmpdir(), "nab-fetch-bun-"));
try {
	const zipPath = join(work, zipName);
	writeFileSync(zipPath, zip);
	// Windows 10+ ships bsdtar, which reads zips; macOS and Linux have unzip.
	if (isWin) execFileSync("tar", ["-xf", zipPath, "-C", work], { stdio: "inherit" });
	else       execFileSync("unzip", ["-q", zipPath, "-d", work], { stdio: "inherit" });

	rmSync(outDir, { recursive: true, force: true });
	mkdirSync(outDir, { recursive: true });
	copyFileSync(join(work, target, isWin ? "bun.exe" : "bun"), outBin);
	if (!isWin) chmodSync(outBin, 0o755);
	writeFileSync(stamp, `${BUN_VERSION} ${target}\n`);
} finally {
	rmSync(work, { recursive: true, force: true });
}

console.log(`fetch-bun: installed ${outBin}`);
