import type { ReactNode, RefObject } from "react";

interface Props {
  lines: string[];
  renderLine: (line: string, index: number) => ReactNode;
  emptyText?: string;
  height?: number | string;
  endRef?: RefObject<HTMLDivElement>;
}

export default function LogPanel({
  lines,
  renderLine,
  emptyText = "No log entries yet.",
  height = "100%",
  endRef,
}: Props) {
  return (
    <div
      style={{
        height,
        overflowY: "auto",
        padding: "12px 16px",
        border: "1px solid #2E2E2E",
        borderRadius: 8,
        background: "#0e0e0e",
        fontFamily: "monospace",
        fontSize: 11,
        lineHeight: 1.6,
      }}
    >
      {lines.length === 0
        ? <div style={{ color: "var(--text-muted)", paddingTop: 16 }}>{emptyText}</div>
        : lines.map(renderLine)
      }
      {endRef && <div ref={endRef} />}
    </div>
  );
}
