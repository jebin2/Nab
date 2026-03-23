"""
YOLOStudio model export script — YOLO26 via Ultralytics.

Reads JSON from stdin:
  { "modelPath": "/abs/path/best.pt", "format": "onnx" }

Writes a single JSON line to stdout:
  { "exportedPath": "/abs/path/best.onnx", "error": null }
  { "exportedPath": "",                     "error": "message" }

Supported formats: onnx, tflite, coreml, openvino
(PyTorch / .pt is handled directly in the Bun backend — no export needed.)
"""

import json
import os
import sys


def suppress_fd1():
    """Redirect both sys.stdout and OS fd 1 to /dev/null."""
    class _Ctx:
        def __enter__(self):
            sys.stdout.flush()
            self._fd_save   = os.dup(1)
            devnull         = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull, 1)
            os.close(devnull)
            self._old_stdout = sys.stdout
            sys.stdout       = open(os.devnull, "w")
            return self
        def __exit__(self, *_):
            sys.stdout.close()
            sys.stdout = self._old_stdout
            os.dup2(self._fd_save, 1)
            os.close(self._fd_save)
    return _Ctx()


def main():
    try:
        config = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"exportedPath": "", "error": f"Invalid config JSON: {e}"}), flush=True)
        sys.exit(1)

    model_path = config["modelPath"]
    fmt        = config["format"]

    try:
        with suppress_fd1():
            from ultralytics import YOLO
            model = YOLO(model_path)
    except Exception as e:
        print(json.dumps({"exportedPath": "", "error": f"Failed to load model: {e}"}), flush=True)
        sys.exit(1)

    try:
        with suppress_fd1():
            exported_path = model.export(format=fmt)
    except Exception as e:
        print(json.dumps({"exportedPath": "", "error": f"Export failed: {e}"}), flush=True)
        sys.exit(1)

    print(json.dumps({"exportedPath": str(exported_path), "error": None}), flush=True)


if __name__ == "__main__":
    main()
