import { useEffect, useRef, useState } from "react";
import { Cpu, Download, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { useEngineStatus, formatSize, downloadTimeRange, formatEta } from "../lib/useEngineStatus";
import { primaryBtn, outlineBtn } from "../lib/styleUtils";

const SUCCESS = "#22C55E";
const DANGER  = "#EF4444";

/**
 * The first-run experience: shown across the top of the app until the
 * training engine is set up. Says what will be downloaded and how big it is
 * before anything starts, then shows real progress.
 */
export default function EngineSetupBanner() {
  const { status, start, cancel } = useEngineStatus();
  const [dismissed, setDismissed] = useState(false);
  const [justFinished, setJustFinished] = useState(false);
  const prevState = useRef<string | null>(null);

  // Show a short "ready" confirmation when an install finishes.
  useEffect(() => {
    if (!status) return;
    if (prevState.current === "installing" && status.state === "ready") setJustFinished(true);
    if (status.state === "installing") setDismissed(false);
    prevState.current = status.state;
  }, [status]);

  if (!status) return null;
  const { state, plan, progress, error, device } = status;

  if (state === "ready") {
    if (!justFinished) return null;
    return (
      <Banner icon={<CheckCircle2 size={18} color={SUCCESS} />} onClose={() => setJustFinished(false)}>
        <Title>Training engine ready</Title>
        <Line>{device?.message ?? "You can start training."}</Line>
      </Banner>
    );
  }

  if (dismissed) return null;

  if (state === "unsupported") {
    return (
      <Banner icon={<AlertTriangle size={18} color="#F59E0B" />} onClose={() => setDismissed(true)}>
        <Title>Training isn't available on this computer</Title>
        <Line>{plan.unsupported} You can still label images.</Line>
      </Banner>
    );
  }

  if (state === "installing") {
    const pct = progress?.pct;
    const sizeText = progress?.totalMB
      ? `${formatSize(progress.doneMB)} of ${formatSize(progress.totalMB)}`
      : progress?.doneMB ? formatSize(progress.doneMB) : "";
    const etaText = progress?.etaSec != null ? formatEta(progress.etaSec) : "";
    return (
      <Banner icon={<Download size={18} color="var(--accent)" />}>
        <Title>Getting the training engine ready</Title>
        <Line>{progress?.phase ?? "Starting"}…</Line>
        <div style={{ height: 6, borderRadius: 3, background: "var(--surface-2)", overflow: "hidden", margin: "8px 0 6px", maxWidth: 520 }}>
          <div style={{
            height: "100%", background: "var(--accent)", transition: "width 0.4s ease",
            width: pct != null ? `${pct}%` : "30%",
            animation: pct == null ? "pulse 1.5s infinite" : undefined,
          }} />
        </div>
        <Line muted>{[pct != null ? `${pct}%` : "", sizeText, etaText].filter(Boolean).join(" · ")}</Line>
        <Actions>
          <button style={outlineBtn} onClick={() => void cancel()}>Cancel</button>
          <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
            You can keep labelling images while this runs.
          </span>
        </Actions>
      </Banner>
    );
  }

  if (state === "failed") {
    return (
      <Banner icon={<AlertTriangle size={18} color={DANGER} />} onClose={() => setDismissed(true)}>
        <Title>Setup didn't finish</Title>
        <Line>{error ?? "Something went wrong."} Anything already downloaded is kept, so trying again is quicker.</Line>
        <Actions>
          <button style={primaryBtn} onClick={() => void start()}>Try again</button>
        </Actions>
      </Banner>
    );
  }

  // missing or outdated: say what will happen before anything is downloaded.
  const mb = plan.downloadMB;
  const outdated = state === "outdated";
  return (
    <Banner icon={<Cpu size={18} color="var(--accent)" />} onClose={() => setDismissed(true)}>
      <Title>{outdated ? "Update the training engine" : "Set up the training engine"}</Title>
      <Line>
        {outdated
          ? "This version of Nab uses newer training components."
          : "Nab needs a one-time download before it can train models. Your images never leave this computer."}
      </Line>
      <Line>{plan.gpuSummary}</Line>
      {mb != null && (
        <Line muted>
          {outdated ? "Up to " : "Download: about "}{formatSize(mb)} ({downloadTimeRange(mb)} on a typical connection).
          Needs about {formatSize(mb * 2.5)} of free disk space.
        </Line>
      )}
      <Actions>
        <button style={primaryBtn} onClick={() => void start()}>
          <Download size={14} /> {outdated ? "Update now" : "Download and set up"}
        </button>
        <button style={outlineBtn} onClick={() => setDismissed(true)}>Later</button>
      </Actions>
    </Banner>
  );
}

function Banner({ icon, children, onClose }: { icon: React.ReactNode; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div role="status" style={{
      display: "flex", gap: 12, alignItems: "flex-start",
      padding: "14px 20px", background: "var(--surface)", borderBottom: "1px solid var(--border)",
      flexShrink: 0,
    }}>
      <div style={{ paddingTop: 1 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {onClose && (
        <button onClick={onClose} aria-label="Dismiss" style={{
          background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2,
        }}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}

const Title = ({ children }: { children: React.ReactNode }) =>
  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>{children}</div>;

const Line = ({ children, muted }: { children: React.ReactNode; muted?: boolean }) =>
  <div style={{ fontSize: 13, color: muted ? "var(--text-muted)" : "var(--text)", lineHeight: 1.5 }}>{children}</div>;

const Actions = ({ children }: { children: React.ReactNode }) =>
  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>{children}</div>;
