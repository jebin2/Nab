"""
Nab inference script — YOLO26 via Ultralytics.

Reads JSON config from stdin:
{
  "imagePath":  "/abs/path/to/image.jpg",
  "modelPath":  "/abs/path/.../best.pt",
  "confidence": 0.5
}

Writes a single JSON line to stdout:
  {"detections": [...], "imageW": 1280, "imageH": 720}
  {"error": "message"}

Each detection:
  { "classIndex": 0, "label": "car", "confidence": 0.87,
    "cx": 0.43, "cy": 0.51, "w": 0.24, "h": 0.19 }
  (cx/cy/w/h are normalized 0–1, center-format, relative to image dims)
"""

import json
import os
import sys
from pathlib import Path
from logger import emit
from yolo_utils import suppress_fd1, is_gpu_available

def main():
    print("[infer] Starting...", file=sys.stderr)
    try:
        config = json.load(sys.stdin)
        print("[infer] Config loaded.", file=sys.stderr)
    except json.JSONDecodeError as e:
        emit({"error": f"Invalid config JSON: {e}"})
        sys.exit(1)

    image_path  = Path(config["imagePath"])
    model_path  = config["modelPath"]
    confidence  = float(config.get("confidence", 0.5))
    device      = config.get("device", "auto")
    print(f"[infer] Device: {device}, Confidence: {confidence}", file=sys.stderr)

    if device == "auto":
        print("[infer] Checking GPU availability...", file=sys.stderr)
        if not is_gpu_available(verbose=True):
            device = "cpu"
            print("[infer] GPU not available/busy, using CPU.", file=sys.stderr)
        else:
            print("[infer] GPU available, using CUDA.", file=sys.stderr)

    if not image_path.exists():
        emit({"error": f"Image not found: {image_path}"})
        sys.exit(1)

    try:
        print(f"[infer] Loading model: {model_path}", file=sys.stderr)
        with suppress_fd1():
            from ultralytics import YOLO
            model = YOLO(model_path)
        print("[infer] Model loaded.", file=sys.stderr)
    except Exception as e:
        emit({"error": f"Failed to load model: {e}"})
        sys.exit(1)

    try:
        print(f"[infer] Running prediction on {image_path}...", file=sys.stderr)
        with suppress_fd1():
            results = model.predict(
                source  = image_path,
                conf    = confidence,
                device  = None if device == "auto" else device,
                save    = False,
                verbose = False,
            )
        print("[infer] Prediction complete.", file=sys.stderr)
    except Exception as e:
        emit({"error": f"Inference failed: {e}"})
        sys.exit(1)

    detections = []
    image_w = image_h = 0

    print("[infer] Processing results...", file=sys.stderr)
    for result in results:
        if result.orig_shape:
            image_h, image_w = result.orig_shape[:2]
        if result.boxes is None or len(result.boxes) == 0:
            continue
        for box in result.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            cls_idx    = int(box.cls[0])
            label      = result.names.get(cls_idx, str(cls_idx))
            conf_score = round(float(box.conf[0]), 4)
            cx = round((x1 + x2) / (2 * image_w), 6)
            cy = round((y1 + y2) / (2 * image_h), 6)
            w  = round((x2 - x1) / image_w, 6)
            h  = round((y2 - y1) / image_h, 6)
            detections.append({
                "classIndex": cls_idx,
                "label":      label,
                "confidence": conf_score,
                "cx": cx, "cy": cy, "w": w, "h": h,
            })

    # Sort highest confidence first.
    detections.sort(key=lambda d: d["confidence"], reverse=True)
    print(f"[infer] Found {len(detections)} detections.", file=sys.stderr)

    emit({
        "detections": detections,
        "imageW":     image_w,
        "imageH":     image_h,
    })


if __name__ == "__main__":
    main()
