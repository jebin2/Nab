import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { dropdownItemHover } from "../lib/styleUtils";

type Option = string | { value: string; label: string };

interface Props {
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  /** Font size for trigger + options. Defaults to 13. */
  fontSize?: number;
  /** Monospace font for trigger label. */
  mono?: boolean;
}

function optValue(o: Option) { return typeof o === "string" ? o : o.value; }
function optLabel(o: Option) { return typeof o === "string" ? o : o.label; }

export default function CustomSelect({ value, options, onChange, fontSize = 13, mono = false }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const selectedLabel = optLabel(options.find(o => optValue(o) === value) ?? value);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", padding: "8px 10px", borderRadius: 6,
          border: "1px solid var(--border)", background: "var(--bg)",
          color: "var(--text)", fontSize, fontFamily: mono ? "monospace" : "inherit",
          outline: "none", boxSizing: "border-box",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selectedLabel}
        </span>
        <ChevronDown
          size={13}
          style={{ flexShrink: 0, opacity: 0.6, marginLeft: 6,
            transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
        />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 200,
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)", overflow: "hidden",
        }}>
          {options.map(opt => {
            const v = optValue(opt);
            const l = optLabel(opt);
            const selected = v === value;
            return (
              <div
                key={v}
                onClick={() => { onChange(v); setOpen(false); }}
                style={{
                  padding: "8px 10px", fontSize, cursor: "pointer",
                  fontFamily: mono ? "monospace" : "inherit",
                  color: selected ? "var(--accent)" : "var(--text)",
                  background: selected ? "rgba(59,130,246,0.08)" : "transparent",
                  transition: "background 0.1s",
                }}
                {...dropdownItemHover(selected)}
              >
                {l}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
