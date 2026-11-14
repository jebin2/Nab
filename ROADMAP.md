# Nab roadmap

Working plan for turning Nab from a working prototype into a tool anyone can use.
Written 2026-11-14. Tick items off here as they land, and keep this file current.

## Goal

**Anyone who has images can make their own object detector, with no ML knowledge.**

The target user has a folder of photos and a question like "find the apples" or
"spot the cracks". They are not a developer. They should get from install to a
working model they can use without reading docs, opening a terminal or knowing
what an epoch is.

What they make must be **theirs**: free to use for anything, commercial included,
with no licence fees and no surprises later.

### Principles

- **Zero setup:** one normal installer. No 7-Zip, no Bun, no Python, no terminal.
- **Plain language first:** "Good / needs more images of X" before mAP charts.
  Expert settings exist, but are tucked away.
- **Local by default:** images and models never leave the machine unless the
  user pushes to Hugging Face.
- **Honest about cost:** say how big a download is and how long training takes
  before it starts.
- **Reproducible installs:** pin every runtime dependency, so an upstream release
  can't break new users.

## The user journey we're building

1. **Install:** one installer per platform, nothing else needed.
2. **First launch:** "Getting the training engine ready (2.4 GB, about 5 min)",
   with real progress. It checks the GPU and says "Training will be fast" or
   "No GPU: training will be slower".
3. **Add images:** drag in a folder. Existing datasets (YOLO, COCO, Pascal VOC,
   or a zip) import in one step.
4. **Label:** draw boxes or polygons. After about 20 labelled images, offer to
   "Pre-label the rest" with a quick background model; the user accepts or fixes
   the suggestions.
5. **Train:** presets instead of knobs: **Quick test (~5 min) / Good (~30 min) /
   Best (2 h+)**. Model size, epochs and image size go under "Advanced".
6. **Results:** a plain verdict ("Finds apples 92% of the time; often misses
   small ones. Add more images with small apples."). Charts live under "Details".
7. **Test:** drop in an image, or use the webcam for a live check.
8. **Use it:** "Download as a program" (single executable), a model file for
   developers (ONNX and others), or push to Hugging Face.

## Current state (v0.1.0, last commit 2026-04-27)

- Electron 33 + React 18 + TypeScript front end (`src/mainview/`).
- Node-side handlers in `src/main/` (renamed from `src/bun/`, left over from
  Electrobun).
- Python scripts in `src/python/` run Ultralytics YOLO for train / infer / export
  / push.
- On first run, `src/main/util.ts` downloads the latest `python-build-standalone`
  CPython 3.12, creates `~/.nab/venv` and `pip install`s `ultralytics psutil`.
- Release workflow in `.github/workflows/release.yml` builds AppImage, tar.gz,
  dmg, zip and an NSIS installer.
- Tests: 10 vitest files in `src/__tests__/` (`npm test`). Typecheck:
  `npm run check`.
- No licence file.

### Known problems

Items marked *(unverified)* come from reading the code and still need
confirming by running the app.

1. **CLI export needs Bun on the user's machine.** `buildCLIArtifact` in
   `src/main/util.ts` runs `spawn("bun", ["build", "--compile", ...])`, but the
   installers don't bundle Bun (`electron-builder.config.ts` only ships
   `cli.ts`/`util.ts`). It works on the dev machine only because `~/.bun` exists.
   *(Confirmed in code 2026-11-14: `spawn("bun", ...)` with no bundled binary. The
   current dev machine has no Bun installed either, so export fails here too.)*
2. **README install steps look stale.** The 7-Zip (Windows) and `zip` (Linux)
   requirements look like leftovers from Electrobun; Electron's installers
   shouldn't need them. *(Confirmed 2026-11-14: electron-builder's NSIS / AppImage /
   dmg targets need neither. Fixed in the README.)*
3. **Unpinned first-run install.** The latest Python build and the latest
   `ultralytics` are fetched at install time, so any upstream release can break
   new installs. On Linux it also pulls about 2–3 GB of PyTorch without warning.
4. **Licence.** There's none, and the engine (Ultralytics) is AGPL-3.0. Ultralytics
   also claims models trained with it fall under their licence, which conflicts
   with the goal. See the licensing section below.
5. **Repo clutter.** About 188 MB of git history even though the current tree is
   small, so large files were committed at some point. (`stitch.zip`, `stitch/`
   and `.codex` are removed.)

## Licensing decision

**Target: MIT for Nab, with a permissively licensed training engine**, so that
both the app and every model people train with it can be used for anything.

- Today the Python scripts import `ultralytics` (AGPL-3.0), and Ultralytics says
  trained models are covered too. A split licence (MIT app + AGPL scripts) would
  still leave users' models under Ultralytics' terms, so it doesn't meet the goal.
- **Plan:** replace Ultralytics with **RF-DETR** (Roboflow, Apache-2.0,
  `pip install rfdetr`; detection and segmentation; built for fine-tuning on
  small datasets). Check that each model size we offer is Apache-2.0; I recall the
  largest sizes having a different licence, so offer only the Apache ones.
- Fallbacks if RF-DETR doesn't work out: D-FINE or YOLOX (both Apache-2.0).
- **Until the switch lands, mark the repo AGPL-3.0** so the licensing is honest
  in the meantime. Switch to MIT in the same release that drops Ultralytics.

## v0.2: "it just works"

Engine-independent fixes. Ship, then launch.

- [x] Confirm known problems 1 and 2 (by reading the code; still worth a real run).
- [ ] **CLI export without Bun:** bundle a Bun binary per platform in
      `extraResources` and call it by full path. *Code done 2026-11-14:*
      `scripts/fetch-bun.mjs` downloads a pinned Bun (1.2.19, checked against
      SHA-256) into `vendor/bun/`, which ships as `resources/bun/`, and CI runs it
      before packaging. *Tested 2026-11-14 on Linux x64:* the script downloads
      and verifies Bun; `buildCLIArtifact` compiles a working CLI with no Bun on
      PATH; a missing Bun returns an error instead of hanging. **Still to do:**
      export from a packaged build, and on macOS and Windows.
- [x] **Fix the README install steps** (drop 7-Zip / `zip` if confirmed stale).
- [ ] **Pin runtime versions:** a fixed `python-build-standalone` release tag
      instead of `latest`, and pinned `ultralytics` / `torch` / `psutil`
      (a requirements file shipped with the app).
- [ ] **First-run screen:** download size, real progress, time estimate, GPU
      check with a plain-language result, retry on failure.
- [ ] **Training presets:** Quick test / Good / Best, mapped to model size and
      epochs; current controls move under "Advanced".
- [ ] **Licence:** add `LICENSE` (AGPL-3.0 for now) and a README note on what it
      means for trained models.
- [x] **Clean up:** remove `stitch.zip`, `stitch/` and `.codex`; rename `src/bun/` to
      `src/main/` (or similar) and fix imports and `electron-builder.config.ts`.
- [ ] **Shrink git history** (optional): find the large blobs and decide whether
      to rewrite history (needs a full clone and a force push; coordinate first).
- [ ] **README rewrite:** a 30-second GIF of label → train → test → export,
      screenshots, a "Why Nab" section, and per-platform install steps.
- [ ] Bump the version to 0.2.0, tag it, and let the release workflow build.
- [ ] **Launch:** posts on r/computervision and r/MachineLearning, and a Show HN.
      Review after 2 weeks.

## v0.3: "your model is yours" (engine switch → MIT)

- [ ] **Spike:** fine-tune RF-DETR on a small dataset on a GPU, and compare
      speed and accuracy with the current YOLO setup. Go or no-go.
- [ ] Rewrite `src/python/train.py`, `infer.py` and `export.py` for RF-DETR
      (about 520 lines today).
- [ ] Update the training-log parser (`src/mainview/lib/logParser.ts`,
      `trainLog.ts`) and the model picker for the new engine's sizes and output.
- [ ] Export formats: ONNX first; TFLite / CoreML / OpenVINO via ONNX conversion,
      or drop them for now and say so.
- [ ] Segmentation (polygons) via RF-DETR-Seg, or detection-only at first.
- [ ] Switch `LICENSE` to MIT, and update the README: "Your model is yours. No
      licence fees, ever."

## v0.4: "anyone can do it"

- [ ] **Pre-labelling:** after about 20 labelled images, train a quick model in
      the background and suggest boxes on the rest (accept / fix / reject).
- [ ] **Dataset import:** YOLO, COCO and Pascal VOC folders or zips; export the
      same formats.
- [ ] **Plain-language results:** a per-class verdict from the validation
      metrics, and hints on what images to add.
- [ ] **Webcam testing** on the Test page.

## Later ideas (not committed)

- Image augmentation presets ("photos taken outdoors", "different angles").
- Duplicate and blurry image detection on import.
- Train on a remote GPU (own server or a cloud notebook) when the local machine
  has none.

## Working notes

- Dev: `npm install`, `npm run fetch-bun` (needed for CLI export), then `npm run dev`. Package: `npm run package`.
- Checks before committing: `npm run check` and `npm test`.
- Electron main process: `src/electron/main.ts`; preload: `src/electron/preload.ts`.
- App support files live in `~/.nab/` (`python-runtime/`, `venv/`, `models/`,
  `hub-logs/`); paths are defined at the top of `src/main/util.ts`.
- Use Node 20 (as CI does). On Node 18, `imageLoader.test.ts` fails because
  `crypto` isn't a global there.
