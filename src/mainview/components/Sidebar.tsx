import { LayoutDashboard, Layers, Cpu, Scan, Upload } from "lucide-react";
import { type NavPage } from "../lib/types";

interface Props {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
}

const NAV_ITEMS: { id: NavPage; label: string; Icon: React.ElementType }[] = [
  { id: "overview",   label: "Overview",   Icon: LayoutDashboard },
  { id: "assets",     label: "Assets",     Icon: Layers },
  { id: "train",      label: "Train",      Icon: Cpu },
  { id: "inference",  label: "Inference",  Icon: Scan },
  { id: "export",     label: "Export",     Icon: Upload },
];


export default function Sidebar({ activePage, onNavigate }: Props) {
  return (
    <aside style={{
      width: 220, minWidth: 220,
      background: "var(--surface)",
      borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      height: "100%",
    }}>
      {/* Logo */}
      <div style={{ height: 56, display: "flex", alignItems: "center", padding: "0 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 28, height: 28,
            background: "var(--accent)",
            borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="6" height="6" rx="1" fill="white" fillOpacity="0.9" />
              <rect x="9" y="1" width="6" height="6" rx="1" fill="white" fillOpacity="0.5" />
              <rect x="1" y="9" width="6" height="6" rx="1" fill="white" fillOpacity="0.5" />
              <rect x="9" y="9" width="6" height="6" rx="1" fill="white" fillOpacity="0.9" />
            </svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.3px", color: "var(--text)" }}>
            Reticle
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "8px", overflowY: "auto" }}>
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const active = activePage === id;
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              style={{
                width: "100%",
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px", borderRadius: 6, border: "none",
                cursor: "pointer",
                background: active ? "rgba(59,130,246,0.12)" : "transparent",
                color: active ? "var(--accent)" : "var(--text-muted)",
                fontWeight: active ? 500 : 400,
                fontSize: 13, textAlign: "left",
                transition: "background 0.15s, color 0.15s",
                marginBottom: 2,
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              <Icon size={15} strokeWidth={active ? 2 : 1.5} />
              {label}
            </button>
          );
        })}
      </nav>

    </aside>
  );
}
