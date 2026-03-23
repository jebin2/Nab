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
import { downloadPythonRuntime } from "../src/bun/util";

const OUT = join(import.meta.dir, "..", "src", "python", "python-runtime.tar.gz");

await downloadPythonRuntime(OUT, async text => console.log(text));
console.log(`✓ Saved → ${OUT}`);
