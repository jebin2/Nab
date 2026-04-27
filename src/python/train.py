"""
Nab training script — YOLO26 via Ultralytics.

Called by the Bun process with a JSON config on stdin:
{
  "runId":       "<uuid>",
  "name":        "vehicles-yolo26n-v1",
  "datasetPath": "/abs/path/to/output/dataset",
  "classMap":    ["car", "truck", "bus"],
  "baseModel":   "yolo26n",
  "epochs":      100,
  "batchSize":   16,
  "imgsz":       640,
  "device":      "auto",
  "outputPath":  "/abs/path/to/output"
}

The dataset directory is pre-populated by the Bun process before this
script runs. Python only writes data.yaml and trains from the existing files.

Progress and results are written to stdout as newline-delimited JSON:
  {"type": "progress", "epoch": 5, "epochs": 100, "loss": 0.432, "mAP": null}
  {"type": "done",     "mAP50": 0.912, "mAP50_95": 0.741, "weightsPath": "..."}
  {"type": "error",    "message": "..."}
"""

import json
import os
import sys
import yaml
from pathlib import Path
from logger import emit
from yolo_utils import is_gpu_available

# Canonical sub-paths for YOLO weight files.
# Ultralytics writes these when project=output_path and name="weights".
WEIGHTS_SUBDIR  = Path("weights") / "weights"
CHECKPOINT_FILE = WEIGHTS_SUBDIR / "last.pt"
MODEL_FILE      = WEIGHTS_SUBDIR / "best.pt"


def load_model(base_model: str, checkpoint: Path, resuming: bool, models_dir: Path):
    from ultralytics import YOLO
    if resuming:
        emit({"type": "stderr", "text": f"[train] Resuming from checkpoint: {checkpoint}"})
        return YOLO(str(checkpoint))
    # Change to the models cache dir so Ultralytics finds (or downloads) the
    # .pt file there rather than in an arbitrary CWD.
    os.chdir(models_dir)
    return YOLO(f"{base_model}.pt")


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


def task_for_model(base_model: str) -> str:
    """Return 'segment' for *-seg models, 'detect' for plain detection models."""
    return "segment" if base_model.endswith("-seg") else "detect"


def prepare_dataset(dataset_path: Path, class_map: list[str], task: str) -> tuple[Path, int]:
    """
    Write data.yaml for a dataset that was already copied by the Bun process.

    Expected layout (pre-populated by Bun):
        <dataset_path>/
            images/train/   ← image files
            labels/train/   ← label .txt files
            data.yaml       ← written here

    Returns (data_yaml_path, image_count).
    """
    img_dir = dataset_path / "images" / "train"
    lbl_dir = dataset_path / "labels" / "train"

    img_dir.mkdir(parents=True, exist_ok=True)
    lbl_dir.mkdir(parents=True, exist_ok=True)

    data_yaml = dataset_path / "data.yaml"
    yaml_content = {
        "path":  str(dataset_path),
        "train": "images/train",
        "val":   "images/train",
        "nc":    len(class_map),
        "names": class_map,
        "task":  task,
    }
    with open(data_yaml, "w") as f:
        yaml.dump(yaml_content, f, default_flow_style=False)

    image_count = len(list(img_dir.iterdir())) if img_dir.exists() else 0
    return data_yaml, image_count


# ── memory helpers ─────────────────────────────────────────────────────────────

def get_ram_mb() -> int | None:
    """RSS memory of this process in MB."""
    # Linux — read VmRSS from /proc/self/status
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) // 1024   # kB → MB
    except Exception:
        pass
    # Windows — use psutil if available
    try:
        import psutil
        return int(psutil.Process().memory_info().rss // (1024 * 1024))
    except Exception:
        pass
    return None


def get_gpu_mb() -> int | None:
    """GPU memory currently allocated by PyTorch in MB, or None if not on GPU."""
    try:
        import torch
        if torch.cuda.is_available():
            return torch.cuda.memory_allocated() // (1024 * 1024)
    except Exception:
        pass
    return None


# ── training callback ──────────────────────────────────────────────────────────

def make_on_train_epoch_end(total_epochs: int, task: str):
    # Metric key suffix differs by task: "(M)" = mask (seg), "(B)" = box (det).
    suffix = "(M)" if task == "segment" else "(B)"

    def on_train_epoch_end(trainer):
        metrics = trainer.metrics or {}

        # Epoch-averaged losses from tloss tensor.
        # Seg: [box, seg, cls, dfl] — Det: [box, cls, dfl]
        loss_box = loss_cls = loss_dfl = None
        try:
            tl = trainer.tloss
            if tl is not None and hasattr(tl, '__len__') and len(tl) >= 3:
                loss_box = round(float(tl[0]), 6)
                loss_cls = round(float(tl[-2]), 6)
                loss_dfl = round(float(tl[-1]), 6)
        except Exception:
            pass

        precision = recall = None
        try:
            p = metrics.get(f"metrics/precision{suffix}")
            r = metrics.get(f"metrics/recall{suffix}")
            if p is not None: precision = round(float(p), 4)
            if r is not None: recall    = round(float(r), 4)
        except Exception:
            pass

        early_stop = bool(getattr(trainer, "stop", False))

        emit({
            "type":        "progress",
            "epoch":       trainer.epoch + 1,
            "epochs":      total_epochs,
            "loss":        round(float(trainer.loss), 6) if trainer.loss is not None else None,
            "lossBox":     loss_box,
            "lossCls":     loss_cls,
            "lossDfl":     loss_dfl,
            "mAP":         round(float(metrics.get(f"metrics/mAP50{suffix}", 0)), 4) if metrics else None,
            "precision":   precision,
            "recall":      recall,
            "ramMB":       get_ram_mb(),
            "gpuMB":       get_gpu_mb(),
            "earlyStop":   early_stop,
        })
    return on_train_epoch_end


# ── main ───────────────────────────────────────────────────────────────────────

def main():
    print("[train] Starting...", file=sys.stderr)
    try:
        config = json.load(sys.stdin)
        print("[train] Config loaded.", file=sys.stderr)
    except json.JSONDecodeError as e:
        emit({"type": "error", "message": f"Invalid config JSON: {e}"})
        sys.exit(1)

    dataset_path = Path(config["datasetPath"]).expanduser()
    models_dir   = Path(config["modelsDir"]).expanduser()
    class_map    = config["classMap"]
    base_model   = config["baseModel"]          # e.g. "yolo26n" or "yolo26n-seg"
    epochs       = int(config["epochs"])
    batch_size   = int(config["batchSize"])     # -1 = auto
    imgsz        = int(config["imgsz"])
    device       = config["device"]             # "auto" | "cpu" | "cuda:0" | "mps"
    print(f"[train] Device: {device}, Epochs: {epochs}, Batch: {batch_size}", file=sys.stderr)

    if device == "auto":
        print("[train] Checking GPU availability...", file=sys.stderr)
        if not is_gpu_available(verbose=True):
            device = "cpu"
            print("[train] GPU not available/busy, using CPU.", file=sys.stderr)
            emit({"type": "stderr", "text": "[train] CUDA unavailable/busy. Falling back to CPU."})
        else:
            print("[train] GPU available, using CUDA.", file=sys.stderr)

    output_path  = Path(config["outputPath"]).expanduser()
    task         = task_for_model(base_model)   # "segment" | "detect"

    models_dir.mkdir(parents=True, exist_ok=True)
    output_path.mkdir(parents=True, exist_ok=True)

    # Validate that the dataset was pre-populated by the Bun copy phase.
    img_dir = dataset_path / "images" / "train"
    if not img_dir.exists() or not any(img_dir.iterdir()):
        emit({"type": "error", "message": "Dataset directory is empty — start a fresh run to rebuild it."})
        sys.exit(1)

    # Write data.yaml (Bun already copied the image/label files).
    try:
        data_yaml, dataset_size = prepare_dataset(dataset_path, class_map, task)
        emit({"type": "dataset", "imageCount": dataset_size})
        print(f"[train] Dataset prepared: {dataset_size} images.", file=sys.stderr)
    except Exception as e:
        emit({"type": "error", "message": f"Failed to prepare dataset: {e}"})
        sys.exit(1)

    # Check for a checkpoint from a previous paused run — resume if found.
    checkpoint = output_path / CHECKPOINT_FILE
    resuming   = bool(config.get("resumeFromCheckpoint", checkpoint.exists()))

    try:
        print(f"[train] Loading model: {base_model}", file=sys.stderr)
        model = load_model(base_model, checkpoint, resuming, models_dir)
        print("[train] Model loaded.", file=sys.stderr)
    except Exception as e:
        emit({"type": "error", "message": f"Failed to load model: {e}"})
        sys.exit(1)

    # Register epoch callback.
    model.add_callback("on_train_epoch_end", make_on_train_epoch_end(epochs, task))

    # Train (or resume).
    try:
        print("[train] Starting training loop...", file=sys.stderr)
        results = train_once(
            model, data_yaml, epochs, batch_size, imgsz,
            device if device != "auto" else None,
            output_path, resuming,
        )
        print("[train] Training complete.", file=sys.stderr)
    except Exception as e:
        emit({"type": "error", "message": f"Training failed: {e}"})
        sys.exit(1)

    # Extract final metrics (key suffix depends on task).
    suffix = "(M)" if task == "segment" else "(B)"
    try:
        metrics      = results.results_dict
        mAP50        = round(float(metrics.get(f"metrics/mAP50{suffix}",    0)), 4)
        mAP50_95     = round(float(metrics.get(f"metrics/mAP50-95{suffix}", 0)), 4)
        weights_path = str(output_path / MODEL_FILE)
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
