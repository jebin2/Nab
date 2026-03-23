#!/usr/bin/env bun
/**
 * YOLOStudio Standalone CLI
 *
 * Single-file Bun executable — download and run anywhere.
 * On first run, sets up a Python virtual environment and installs ultralytics.
 * Subsequent runs are instant.
 *
 * Usage:
 *   ./detect photo.jpg
 *   ./detect photo.jpg --conf 0.7
 *   ./detect photo.jpg --conf 0.5 --output results/
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve, basename } from "path";
import { homedir, tmpdir } from "os";
import { createHash } from "crypto";

// ── Embedded assets (Bun embeds these at `bun build --compile` time) ──────────
const modelFile = Bun.file(new URL("./model.pt", import.meta.url));
const cliPyFile = Bun.file(new URL("./cli.py",   import.meta.url));

// ── Paths — mirrors what YOLOStudio itself uses ────────────────────────────────
const IS_WIN      = process.platform === "win32";
const VENV_DIR    = join(homedir(), ".yolostudio", "venv");
const VENV_PYTHON = IS_WIN ? join(VENV_DIR, "Scripts", "python.exe") : join(VENV_DIR, "bin", "python");
const VENV_READY  = join(VENV_DIR, ".ready");

// ── Environment setup (same flow as YOLOStudio's prepareEnvironment) ──────────
async function ensureEnvironment() {
  if (existsSync(VENV_READY)) return; // already set up

  console.log("[setup] Python environment not found at ~/.yolostudio/venv");
  console.log("[setup] Setting up (one-time — may take a few minutes)...");

  // Locate system python3
  const whichResult = IS_WIN
    ? Bun.spawnSync(["where", "python"])
    : Bun.spawnSync(["which", "python3"]);
  const python3 = new TextDecoder().decode(whichResult.stdout).split("\n")[0].trim();
  if (!python3) {
    console.error("Error: python3 not found in PATH. Please install Python 3.8+.");
    process.exit(1);
  }

  // Create venv
  console.log("[setup] Creating virtual environment...");
  const venvResult = Bun.spawnSync([python3, "-m", "venv", VENV_DIR], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (venvResult.exitCode !== 0) {
    console.error("Error: Failed to create virtual environment.");
    process.exit(1);
  }

  // pip install ultralytics
  const pip = IS_WIN ? join(VENV_DIR, "Scripts", "pip.exe") : join(VENV_DIR, "bin", "pip");
  console.log("[setup] Installing ultralytics (downloading ~200 MB on first run)...");
  const pipResult = Bun.spawnSync([pip, "install", "ultralytics"], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (pipResult.exitCode !== 0) {
    console.error("Error: pip install failed.");
    process.exit(1);
  }

  writeFileSync(VENV_READY, "ready");
  console.log("[setup] Environment ready.\n");
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const args = Bun.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    const bin = basename(process.execPath);
    console.log(`Usage: ./${bin} <image.jpg> [options]`);
    console.log("\nOptions:");
    console.log("  --conf    Confidence threshold 0–1  (default: 0.5)");
    console.log("  --output  Output directory for annotated images (default: ./output)");
    process.exit(0);
  }

  const imagePath = resolve(args[0]);
  let confidence = 0.5;
  let outputDir  = "output";

  for (let i = 1; i < args.length; i++) {
    if ((args[i] === "--conf"   || args[i] === "-c") && args[i + 1]) confidence = parseFloat(args[++i]);
    if ((args[i] === "--output" || args[i] === "-o") && args[i + 1]) outputDir  = args[++i];
  }

  if (!existsSync(imagePath)) {
    console.error(`Error: image not found: ${imagePath}`);
    process.exit(1);
  }

  // Ensure Python venv + ultralytics installed
  await ensureEnvironment();

  // Extract embedded model to ~/.yolostudio/models/ (keyed by content hash)
  const modelBytes = await modelFile.bytes();
  const modelHash  = createHash("sha1").update(modelBytes.slice(0, 4096)).digest("hex").slice(0, 8);
  const modelsDir  = join(homedir(), ".yolostudio", "models");
  mkdirSync(modelsDir, { recursive: true });
  const modelPath  = join(modelsDir, `model_${modelHash}.pt`);
  if (!existsSync(modelPath)) {
    process.stdout.write("Extracting model... ");
    writeFileSync(modelPath, modelBytes);
    console.log("done");
  }

  // Write embedded cli.py to a temp location
  const cliPyPath = join(tmpdir(), "yolostudio_cli.py");
  writeFileSync(cliPyPath, await cliPyFile.text());

  // Run inference via the Python CLI script
  console.log(`Detecting: ${basename(imagePath)}`);
  const proc = Bun.spawnSync(
    [VENV_PYTHON, cliPyPath, imagePath, "--model", modelPath, "--conf", String(confidence), "--output", outputDir],
    { stdio: ["inherit", "inherit", "inherit"] },
  );
  process.exit(proc.exitCode ?? 0);
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
