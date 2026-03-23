import { ChevronLeft } from "lucide-react";

// ── DetailPageHeader ──────────────────────────────────────────────────────────
// Shared header for detail views (RunDetailView, Annotate).
// Layout: [Back] [divider] [title] [badge?] [if meta: divider + meta] [spacer] [actions?]

interface Props {
  onBack: () => void;
  backLabel?: string;        // default "Back"
  title: React.ReactNode;    // main title — rendered in monospace bold with ellipsis
  badge?: React.ReactNode;   // optional colored pill after the title
  meta?: React.ReactNode;    // optional info block shown after a divider (e.g. image counter)
  actions?: React.ReactNode; // right-side action buttons
}

export default function DetailPageHeader({ onBack, backLabel = "Back", title, badge, meta, actions }: Props) {
  return (
    <div style={{
      height: 56, padding: "0 24px",
      borderBottom: "1px solid var(--border)",
      display: "flex", alignItems: "center", gap: 16, flexShrink: 0,
    }}>
      <button
        onClick={onBack}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          background: "none", border: "none", cursor: "pointer",
          color: "var(--text-muted)", fontSize: 13, fontFamily: "inherit", padding: "4px 0",
        }}
      >
        <ChevronLeft size={15} /> {backLabel}
      </button>

      <div style={{ width: 1, height: 16, background: "var(--border)" }} />

      <span style={{
        fontFamily: "monospace", fontWeight: 700, fontSize: 14,
        color: "var(--text)", flex: 1, overflow: "hidden",
        textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {title}
      </span>

      {badge}

      {meta && (
        <>
          <div style={{ width: 1, height: 16, background: "var(--border)" }} />
          {meta}
        </>
      )}

      {actions}
    </div>
  );
}

// ── HeaderBtn ─────────────────────────────────────────────────────────────────
// Solid colored action button used in detail view top bars.

interface HeaderBtnProps {
  onClick: () => void;
  bg: string;
  disabled?: boolean;
  children: React.ReactNode;
}

export function HeaderBtn({ onClick, bg, disabled, children }: HeaderBtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "6px 16px", borderRadius: 6,
        border: "none", background: disabled ? "var(--border)" : bg,
        color: disabled ? "var(--text-muted)" : "#fff",
        fontSize: 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}
