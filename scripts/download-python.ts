#!/usr/bin/env bun
/**
 * Downloads a standalone Python build (python-build-standalone by Astral)
 * for the current platform at build time and saves it to:
 *
 *   src/python/python-runtime.tar.gz
 *
 * This tarball is bundled inside the app by electrobun and extracted on
 * first training run — no system Python required on end-user machines.
 */

import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";

const OUT = join(import.meta.dir, "..", "src", "python", "python-runtime.tar.gz");

// ── Platform → asset suffix mapping ──────────────────────────────────────────

const PLATFORM_MAP: Record<string, string> = {
  "linux-x64":    "x86_64-unknown-linux-gnu-install_only_stripped.tar.gz",
  "linux-arm64":  "aarch64-unknown-linux-gnu-install_only_stripped.tar.gz",
  "darwin-x64":   "x86_64-apple-darwin-install_only_stripped.tar.gz",
  "darwin-arm64": "aarch64-apple-darwin-install_only_stripped.tar.gz",
  "win32-x64":    "x86_64-pc-windows-msvc-install_only_stripped.tar.gz",
};

const platformKey = `${process.platform}-${process.arch}`;
const suffix = PLATFORM_MAP[platformKey];

if (!suffix) {
  console.error(`✗ Unsupported platform: ${platformKey}`);
  console.error(`  Supported: ${Object.keys(PLATFORM_MAP).join(", ")}`);
  process.exit(1);
}

// ── Fetch latest release from GitHub API ─────────────────────────────────────

console.log(`▶ Fetching latest python-build-standalone release for ${platformKey}…`);

const apiRes = await fetch(
  "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest",
  { headers: { "User-Agent": "YOLOStudio-build" } }
);

if (!apiRes.ok) {
  console.error(`✗ GitHub API error: ${apiRes.status} ${apiRes.statusText}`);
  process.exit(1);
}

const release = await apiRes.json() as { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> };

// Pick the cpython-3.12 asset matching our platform suffix.
const asset = release.assets.find(a =>
  a.name.startsWith("cpython-3.12") && a.name.endsWith(suffix)
);

if (!asset) {
  console.error(`✗ No Python 3.12 asset found for suffix: ${suffix}`);
  console.error(`  Available assets: ${release.assets.map(a => a.name).join("\n  ")}`);
  process.exit(1);
}

console.log(`  Found: ${asset.name}`);
console.log(`  Tag:   ${release.tag_name}`);

// ── Download ──────────────────────────────────────────────────────────────────

console.log("▶ Downloading…");

const dlRes = await fetch(asset.browser_download_url);
if (!dlRes.ok || !dlRes.body) {
  console.error(`✗ Download failed: ${dlRes.status}`);
  process.exit(1);
}

const total = Number(dlRes.headers.get("content-length") ?? 0);
let received = 0;
const chunks: Uint8Array[] = [];
const reader = dlRes.body.getReader();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  chunks.push(value);
  received += value.length;
  if (total > 0) {
    const pct = ((received / total) * 100).toFixed(0);
    process.stdout.write(`\r  ${pct}% (${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)`);
  }
}

process.stdout.write("\n");

await mkdir(join(import.meta.dir, "..", "src", "python"), { recursive: true });

const buf = new Uint8Array(received);
let offset = 0;
for (const chunk of chunks) { buf.set(chunk, offset); offset += chunk.length; }

await writeFile(OUT, buf);
console.log(`✓ Saved → ${OUT} (${(received / 1e6).toFixed(1)} MB)`);
