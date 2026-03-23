import { Scan } from "lucide-react";

export default function Inference() {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <div style={{ height: 56, padding: "0 28px", display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>Inference</span>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Scan size={32} color="var(--border)" strokeWidth={1.5} />
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-muted)" }}>Coming soon</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", opacity: 0.6 }}>Run a trained model on images or webcam</div>
      </div>
    </div>
  );
}
