import { Upload } from "lucide-react";

export default function Export() {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <div style={{ height: 56, padding: "0 28px", display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>Export</span>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Upload size={32} color="var(--border)" strokeWidth={1.5} />
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-muted)" }}>Coming soon</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", opacity: 0.6 }}>Export trained models to ONNX, CoreML, TFLite, TensorRT</div>
      </div>
    </div>
  );
}
