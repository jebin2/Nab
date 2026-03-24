interface Props {
  width?: number;
  maxHeight?: string;
  zIndex?: number;
  onClose: () => void;
  children: React.ReactNode;
}

export default function Modal({ width = 420, maxHeight, zIndex = 100, onClose, children }: Props) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex,
        background: "rgba(0,0,0,0.6)", display: "flex",
        alignItems: "center", justifyContent: "center",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width, background: "var(--surface)", borderRadius: 10,
        border: "1px solid var(--border)", padding: "24px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        ...(maxHeight ? { maxHeight, overflowY: "auto" as const } : {}),
      }}>
        {children}
      </div>
    </div>
  );
}
