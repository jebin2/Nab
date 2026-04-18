import type React from "react";
import { pageHeader } from "../lib/styleUtils";

interface Props {
  title: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

export default function PageLayout({ title, headerAction, children }: Props) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <div style={pageHeader}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>
          {title}
        </span>
        {headerAction ?? <div />}
      </div>

      {children}
    </div>
  );
}
