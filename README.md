# YOLOStudio

A no-code desktop application for training custom YOLO object detection models. Annotate images, configure training, monitor progress, and run inference — all without writing a single line of code or touching a terminal.

## Features

- **Image Annotation** — Canvas-based bounding box drawing with class management and keyboard shortcuts
- **Dataset Management** — Drag-and-drop image import, thumbnail grid, per-class counts, train/val split controls
- **Model Training** — Configure epochs, image size, and batch size; monitor live loss curves and streamed logs
- **YOLO Model Selection** — Choose from YOLO26 base models (yolo26n / s / m / l / x)
- **Live Inference** — Run trained models on images or webcam with WebGPU-accelerated rendering
- **Model Export** — Export to PyTorch (`.pt`) or ONNX (`.onnx`) formats
- **Project Persistence** — Assets and training runs auto-saved locally

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electrobun |
| UI | React 18 + TypeScript + Tailwind CSS |
| Build | Bun + Vite |
| Training engine | Python sidecar (Ultralytics YOLO) |
| Inference | ONNX Runtime Web (WebGPU → WASM fallback) |

## Getting Started

```bash
# Install dependencies
bun install

# Development (with file watching)
bun run dev

# Build for production
bun run build
```

## Project Structure

```
├── src/
│   ├── bun/
│   │   └── index.ts              # Main process (Electrobun/Bun), IPC, file I/O
│   ├── python/                   # Python training & inference scripts
│   └── mainview/
│       ├── App.tsx               # Root component, navigation, global state
│       ├── pages/                # Overview, Assets, Annotate, Train, Inference, Export
│       ├── components/           # Reusable UI components
│       └── lib/
│           ├── types.ts          # Shared type definitions
│           └── rpc.ts            # RPC client for Bun backend
├── electrobun.config.ts          # Electrobun configuration
├── vite.config.ts                # Vite configuration
└── tailwind.config.js            # Tailwind configuration
```
