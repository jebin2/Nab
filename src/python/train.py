"""
YOLOStudio training script — YOLO26 via Ultralytics.

Called by the Bun process with a JSON config on stdin:
{
  "runId":      "<uuid>",
  "name":       "vehicles-yolo26n-v1",
  "assetPaths": ["/abs/path/to/asset1", ...],
  "classMap":   ["car", "truck", "bus"],
  "baseModel":  "yolo26n",
  "epochs":     100,
  "batchSize":  16,
  "imgsz":      640,
  "device":     "auto",
  "outputPath": "/abs/path/to/output"
}

Progress and results are written to stdout as newline-delimited JSON:
  {"type": "progress", "epoch": 5, "epochs": 100, "loss": 0.432, "mAP": null}
  {"type": "done",     "mAP50": 0.912, "mAP50_95": 0.741, "weightsPath": "..."}
  {"type": "error",    "message": "..."}
"""

import json
import os
import shutil
import subprocess
import sys
import yaml
from pathlib import Path


# ── helpers ────────────────────────────────────────────────────────────────────

def emit(obj: dict):
    print(json.dumps(obj), flush=True)


def load_model(base_model: str, checkpoint: Path, resuming: bool):
    from ultralytics import YOLO
    if resuming:
        emit({"type": "stderr", "text": f"[train] Resuming from checkpoint: {checkpoint}"})
        return YOLO(str(checkpoint))
    return YOLO(f"{base_model}.pt")


def is_cuda_unavailable_error(err: Exception) -> bool:
    text = str(err).lower()
    return (
        "cuda-capable device(s) is/are busy or unavailable" in text or
        "cudaerrordevicesunavailable" in text or
        ("cuda error" in text and "busy or unavailable" in text)
    )


def train_once(model, data_yaml: Path, epochs: int, batch_size: int, imgsz: int, device, output_path: Path, resuming: bool):
    return model.train(
        data      = str(data_yaml),
        epochs    = epochs,
        batch     = batch_size,
        imgsz     = imgsz,
        device    = device,
        project   = str(output_path),
        name      = "weights",
        exist_ok  = True,
        resume    = resuming,
        verbose   = False,
    )


def retry_on_cpu(config: dict):
    cpu_config = dict(config)
    cpu_config["device"] = "cpu"
    cpu_config["resumeFromCheckpoint"] = False

    env = dict(os.environ)
    env["CUDA_VISIBLE_DEVICES"] = "-1"
    env["YOLOSTUDIO_CPU_FALLBACK"] = "1"

    proc = subprocess.Popen(
        [sys.executable, __file__],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    proc.stdin.write(json.dumps(cpu_config))
    proc.stdin.close()

    for line in proc.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()

    stderr_output = proc.stderr.read()
    proc.wait()

    if stderr_output:
        for line in stderr_output.splitlines():
            emit({"type": "stderr", "text": f"[train] {line}"})

    if proc.returncode != 0:
        raise RuntimeError((stderr_output or "CPU fallback failed").strip())


def build_dataset(asset_paths: list[str], class_map: list[str], output_dir: Path) -> Path:
    """
    Merge multiple asset folders (each with images/ and labels/) into a single
    dataset directory and write a data.yaml for Ultralytics.

    Asset folder layout (written by YOLOStudio):
        <asset>/images/   ← image files
        <asset>/labels/   ← YOLO .txt files (class_id cx cy w h)
        <asset>/classes.txt

    Output layout:
        <output_dir>/dataset/
            images/train/   ← all images merged
            labels/train/   ← all labels merged
            data.yaml
    """
    dataset_dir = output_dir / "dataset"
    img_dir     = dataset_dir / "images" / "train"
    lbl_dir     = dataset_dir / "labels" / "train"
    img_dir.mkdir(parents=True, exist_ok=True)
    lbl_dir.mkdir(parents=True, exist_ok=True)

    for asset_path in asset_paths:
        asset = Path(asset_path)
        src_images = asset / "images"
        src_labels = asset / "labels"

        if not src_images.exists():
            continue

        for img_file in src_images.iterdir():
            if not img_file.is_file():
                continue

            dest_img = img_dir / img_file.name
            # Avoid filename collisions across assets by prefixing with asset name.
            if dest_img.exists():
                dest_img = img_dir / f"{asset.name}__{img_file.name}"
            shutil.copy2(img_file, dest_img)

            # Copy corresponding label file.
            lbl_file = src_labels / (img_file.stem + ".txt")
            if lbl_file.exists():
                dest_lbl = lbl_dir / dest_img.with_suffix(".txt").name
                shutil.copy2(lbl_file, dest_lbl)

    # Write data.yaml.
    data_yaml = dataset_dir / "data.yaml"
    yaml_content = {
        "path":  str(dataset_dir),
        "train": "images/train",
        "val":   "images/train",   # use same split for now; proper split can be added later
        "nc":    len(class_map),
        "names": class_map,
    }
    with open(data_yaml, "w") as f:
        yaml.dump(yaml_content, f, default_flow_style=False)

    return data_yaml


# ── training callback ──────────────────────────────────────────────────────────

def make_on_train_epoch_end(total_epochs: int):
    def on_train_epoch_end(trainer):
        metrics = trainer.metrics or {}
        emit({
            "type":   "progress",
            "epoch":  trainer.epoch + 1,
            "epochs": total_epochs,
            "loss":   round(float(trainer.loss), 6) if trainer.loss is not None else None,
            "mAP":    round(float(metrics.get("metrics/mAP50(B)", 0)), 4) if metrics else None,
        })
    return on_train_epoch_end


# ── main ───────────────────────────────────────────────────────────────────────

def main():
    try:
        config = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        emit({"type": "error", "message": f"Invalid config JSON: {e}"})
        sys.exit(1)

    asset_paths  = config["assetPaths"]
    class_map    = config["classMap"]
    base_model   = config["baseModel"]          # e.g. "yolo26n"
    epochs       = int(config["epochs"])
    batch_size   = int(config["batchSize"])     # -1 = auto
    imgsz        = int(config["imgsz"])
    device       = config["device"]             # "auto" | "cpu" | "cuda:0" | "mps"
    output_path  = Path(config["outputPath"]).expanduser()

    output_path.mkdir(parents=True, exist_ok=True)

    # Build merged dataset.
    try:
        data_yaml = build_dataset(asset_paths, class_map, output_path)
    except Exception as e:
        emit({"type": "error", "message": f"Failed to build dataset: {e}"})
        sys.exit(1)

    # Check for a checkpoint from a previous paused run — resume if found.
    checkpoint = output_path / "weights" / "weights" / "last.pt"
    resuming   = bool(config.get("resumeFromCheckpoint", checkpoint.exists()))

    try:
        model = load_model(base_model, checkpoint, resuming)
    except Exception as e:
        emit({"type": "error", "message": f"Failed to load model: {e}"})
        sys.exit(1)

    # Register epoch callback.
    model.add_callback("on_train_epoch_end", make_on_train_epoch_end(epochs))

    # Train (or resume).
    try:
        results = train_once(
            model, data_yaml, epochs, batch_size, imgsz,
            device if device != "auto" else None,
            output_path, resuming,
        )
    except Exception as e:
        if (
            device == "auto" and
            os.environ.get("YOLOSTUDIO_CPU_FALLBACK") != "1" and
            is_cuda_unavailable_error(e)
        ):
            emit({"type": "stderr", "text": "[train] CUDA unavailable for auto device; retrying on CPU…"})
            try:
                if resuming:
                    emit({"type": "stderr", "text": "[train] CPU fallback disables checkpoint resume and restarts from base model."})
                retry_on_cpu(config)
                return
            except Exception as cpu_err:
                emit({"type": "error", "message": f"Training failed after CPU fallback: {cpu_err}"})
                sys.exit(1)
        else:
            emit({"type": "error", "message": f"Training failed: {e}"})
            sys.exit(1)

    # Extract final metrics.
    try:
        metrics      = results.results_dict
        mAP50        = round(float(metrics.get("metrics/mAP50(B)",    0)), 4)
        mAP50_95     = round(float(metrics.get("metrics/mAP50-95(B)", 0)), 4)
        weights_path = str(output_path / "weights" / "weights" / "best.pt")
    except Exception:
        mAP50 = mAP50_95 = 0.0
        weights_path = ""

    emit({
        "type":        "done",
        "mAP50":       mAP50,
        "mAP50_95":    mAP50_95,
        "weightsPath": weights_path,
    })


if __name__ == "__main__":
    main()
