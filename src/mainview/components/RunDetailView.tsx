import { useState, useEffect, useRef, useMemo } from "react";
import { Play, Pause, Square, Terminal, ChevronDown } from "lucide-react";
import DetailPageHeader, { HeaderBtn } from "./DetailPageHeader";
import { type TrainingRun } from "../lib/types";
import { RUN_STATUS_LABELS, RUN_STATUS_COLORS, DEVICES, CLASS_COLORS } from "../lib/constants";
import { getRPC } from "../lib/rpc";
import { parseLog, type LogProgress } from "../lib/trainLog";

// ── Config strip helpers ───────────────────────────────────────────────────────

const CONFIG_VALUE_STYLE: React.CSSProperties = {
  fontSize: 12, lineHeight: "18px", fontFamily: "monospace", color: "var(--text)",
};

function ConfigStatField({ label, value, width }: { label: string; value: string; width?: number }) {
  return (
    <div style={{ flexShrink: 0, width }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{label}</div>
      <div style={{ ...CONFIG_VALUE_STYLE, height: 18 }}>{value}</div>
    </div>
  );
}

function ConfigNumField({ label, value, min, max, editable, format, onChange }: {
  label: string; value: number; min: number; max: number;
  editable: boolean; format?: (v: number) => string; onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const display = format ? format(value) : String(value);

  function commit(raw: string) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= min && n <= max) onChange(n);
    setEditing(false);
  }

  return (
    <div style={{ flexShrink: 0, width: 58 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{label}</div>
      <div style={{ height: 18, position: "relative" }}>
        <input
          value={editing ? draft : ""}
          onChange={e => setDraft(e.target.value)}
          onFocus={() => { setDraft(String(value)); setEditing(true); }}
          onBlur={() => commit(draft)}
          onKeyDown={e => { if (e.key === "Enter") commit(draft); if (e.key === "Escape") { setEditing(false); (e.target as HTMLInputElement).blur(); } }}
          readOnly={!editing}
          style={{
            ...CONFIG_VALUE_STYLE,
            position: "absolute", inset: 0, width: "100%",
            padding: 0, margin: 0, background: "transparent",
            border: "none", borderBottom: editing ? "1px solid var(--accent)" : editable ? "1px dashed var(--border)" : "1px solid transparent",
            outline: "none", cursor: editable ? "text" : "default",
            color: editing ? "var(--text)" : "transparent",
          }}
        />
        {!editing && <div style={{ ...CONFIG_VALUE_STYLE, pointerEvents: "none" }}>{display}</div>}
      </div>
    </div>
  );
}

function ConfigSelectField({ label, value, options, editable, onChange }: {
  label: string; value: string; options: string[];
  editable: boolean; onChange: (v: string) => void;
}) {
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

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0, width: 72 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{label}</div>
      <div style={{ height: 18 }}>
        <div
          onClick={() => { if (editable) setOpen(o => !o); }}
          title={editable ? "Click to edit" : undefined}
          style={{ ...CONFIG_VALUE_STYLE, cursor: editable ? "pointer" : "default", display: "flex", alignItems: "center", gap: 4, borderBottom: editable ? "1px dashed var(--border)" : "1px solid transparent" }}
        >
          {value}
          {editable && <ChevronDown size={10} style={{ opacity: 0.5 }} />}
        </div>
      </div>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200, minWidth: 90, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", overflow: "hidden" }}>
          {options.map(opt => (
            <div
              key={opt}
              onClick={() => { onChange(opt); setOpen(false); }}
              style={{ padding: "7px 10px", fontSize: 12, fontFamily: "monospace", cursor: "pointer", color: opt === value ? "var(--accent)" : "var(--text)", background: opt === value ? "rgba(59,130,246,0.08)" : "transparent" }}
              onMouseEnter={e => { if (opt !== value) (e.currentTarget as HTMLDivElement).style.background = "var(--bg)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = opt === value ? "rgba(59,130,246,0.08)" : "transparent"; }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── MemoryBar ─────────────────────────────────────────────────────────────────

function MemoryBar({ label, valueMB, peakMB, color }: { label: string; valueMB: number; peakMB: number; color: string }) {
  const fmt = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
      <div style={{ textAlign: "right" }}>
        <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color }}>{fmt(valueMB)}</span>
        {peakMB > valueMB && <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>↑ {fmt(peakMB)}</div>}
      </div>
    </div>
  );
}

// ── LogLine ───────────────────────────────────────────────────────────────────

function LogLine({ line }: { line: string }) {
  try {
    const ev = JSON.parse(line);
    if (ev.type === "start")    return <div style={{ color: "var(--text-muted)", marginBottom: 2, opacity: 0.6 }}>● run started {new Date(ev.timestamp).toLocaleString()}</div>;
    if (ev.type === "progress") return (
      <div style={{ color: "var(--text)", marginBottom: 1 }}>
        <span style={{ color: "var(--text-muted)" }}>epoch {String(ev.epoch).padStart(4)} </span>
        {ev.loss != null && <span>loss <span style={{ color: "#F97316" }}>{ev.loss.toFixed(4)}</span>  </span>}
        {ev.mAP  != null && <span>mAP <span style={{ color: "#22C55E" }}>{ev.mAP.toFixed(4)}</span></span>}
      </div>
    );
    if (ev.type === "done")   return <div style={{ color: "#22C55E", marginTop: 4, fontWeight: 700 }}>✓ done — mAP50: {ev.mAP50.toFixed(4)}  mAP50-95: {ev.mAP50_95.toFixed(4)}</div>;
    if (ev.type === "error")  return <div style={{ color: "#EF4444", marginTop: 4 }}>✗ error: {ev.message}</div>;
    if (ev.type === "stderr") return <div style={{ color: "#F59E0B", marginBottom: 1, opacity: 0.8 }}>{ev.text}</div>;
  } catch {}
  return <div style={{ color: "var(--text-muted)", marginBottom: 1 }}>{line}</div>;
}

// ── RunDetailView ─────────────────────────────────────────────────────────────

interface Props {
  run: TrainingRun;
  progress?: LogProgress;
  onClose: () => void;
  onUpdate: (patch: Partial<TrainingRun>) => void;
  onStartFresh: () => void;
  onResume: () => void;
  onPause: () => void;
  onStop: () => void;
}

export default function RunDetailView({ run, progress, onClose, onUpdate, onStartFresh, onResume, onPause, onStop }: Props) {
  const [lines,   setLines]   = useState<string[]>([]);
  const [runMeta, setRunMeta] = useState<{ found: boolean; classMap: string[]; imageCount: number; newCount: number; modifiedCount: number } | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const peakRamMB = useMemo(() => { let p = 0; for (const l of lines) { try { const ev = JSON.parse(l); if (ev.type === "progress" && ev.ramMB != null) p = Math.max(p, ev.ramMB); } catch {} } return p || null; }, [lines]);
  const peakGpuMB = useMemo(() => { let p = 0; for (const l of lines) { try { const ev = JSON.parse(l); if (ev.type === "progress" && ev.gpuMB != null) p = Math.max(p, ev.gpuMB); } catch {} } return p || null; }, [lines]);

  useEffect(() => {
    let active = true;
    async function load() {
      try { const { lines: l } = await getRPC().request.readTrainingLog({ outputPath: run.outputPath }); if (active) setLines(l); } catch {}
    }
    load();
    const id = setInterval(load, 1000);
    return () => { active = false; clearInterval(id); };
  }, [run.id, run.outputPath]);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [lines.length]);

  useEffect(() => {
    getRPC().request.readRunMeta({ outputPath: run.outputPath }).then(setRunMeta).catch(() => {});
  }, [run.id, run.status]);

  const { done } = parseLog(lines);
  const statusColor  = RUN_STATUS_COLORS[run.status];
  const pct          = run.status === "done" ? 100 : progress ? Math.round((progress.epoch / progress.epochs) * 100) : 0;
  const totalEpochs  = progress?.epochs ?? run.epochs;
  const currentEpoch = progress?.epoch  ?? (run.status === "done" ? run.epochs : 0);
  const mAP50   = done?.mAP50    ?? run.mAP    ?? progress?.mAP ?? null;
  const mAP5095 = done?.mAP50_95 ?? null;

  const { chartPoints, liveDot } = useMemo(() => {
    const pts: Array<{ epoch: number; loss: number }> = [];
    for (const line of lines) { try { const ev = JSON.parse(line); if (ev.type === "progress" && ev.loss != null) pts.push({ epoch: ev.epoch, loss: ev.loss }); } catch {} }
    if (pts.length < 2) return { chartPoints: "", liveDot: null as { cx: number; cy: number } | null };
    const maxE = pts[pts.length - 1].epoch;
    const losses = pts.map(d => d.loss);
    const minL = Math.min(...losses);
    const rangeL = (Math.max(...losses) - minL) || 1;
    const toXY = (d: { epoch: number; loss: number }) => ({ x: (d.epoch / maxE) * 800, y: 200 - ((d.loss - minL) / rangeL) * 160 - 20 });
    const points = pts.map(toXY);
    const last = points[points.length - 1];
    return { chartPoints: points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "), liveDot: run.status === "training" ? { cx: last.x, cy: last.y } : null };
  }, [lines, run.status]);

  const editable = run.status === "idle" || run.status === "paused";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>

      <DetailPageHeader
        onBack={onClose}
        title={run.name}
        badge={
          <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: statusColor + "22", border: `1px solid ${statusColor}55`, color: statusColor, letterSpacing: "0.04em", textTransform: "uppercase", flexShrink: 0 }}>
            {RUN_STATUS_LABELS[run.status]}
          </span>
        }
        actions={<>
          {(run.status === "idle" || run.status === "done" || run.status === "failed") && (
            <HeaderBtn onClick={onStartFresh} bg="var(--accent)"><Play size={13} fill="#fff" />{run.status === "idle" ? "Start" : run.status === "done" ? "Start Again" : "Retry"}</HeaderBtn>
          )}
          {run.status === "paused" && <HeaderBtn onClick={onResume} bg="#3B82F6"><Play size={13} fill="#fff" /> Resume</HeaderBtn>}
          {run.status === "training" && <HeaderBtn onClick={onPause} bg="#F97316"><Pause size={13} fill="#fff" /> Pause</HeaderBtn>}
          {(run.status === "training" || run.status === "installing" || run.status === "paused") && (
            <HeaderBtn onClick={onStop} bg="#EF4444"><Square size={13} fill="#fff" /> Stop</HeaderBtn>
          )}
        </>}
      />

      {/* Config strip */}
      <div style={{ padding: "10px 24px", borderBottom: "1px solid var(--border)", display: "flex", gap: 28, alignItems: "center", flexShrink: 0, flexWrap: "wrap", background: "var(--surface)" }}>
        <ConfigStatField label="Model" value={run.baseModel} width={72} />
        <ConfigNumField label="Epochs" value={run.epochs} min={1} max={10000} editable={editable} onChange={v => onUpdate({ epochs: v })} />
        <ConfigNumField label="Batch" value={run.batchSize} min={-1} max={1024} editable={editable} format={v => v === -1 ? "auto" : String(v)} onChange={v => onUpdate({ batchSize: v })} />
        <ConfigNumField label="Img" value={run.imgsz} min={32} max={1280} editable={editable} format={v => `${v}px`} onChange={v => onUpdate({ imgsz: v })} />
        <ConfigSelectField label="Device" value={run.device} options={DEVICES} editable={editable} onChange={v => onUpdate({ device: v })} />
        <ConfigStatField label="Classes" value={String(run.classMap.length)} width={58} />
      </div>

      {/* Main: chart (left) + metrics (right) */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 280px", gap: 0, overflow: "hidden" }}>

        {/* Left: chart + terminal */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid var(--border)" }}>

          {/* Loss chart */}
          <div style={{ padding: "16px 20px", background: "var(--surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              {(run.status === "installing" || run.status === "training") && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", display: "inline-block", animation: "pulse 1.5s infinite" }} />}
              {run.status === "paused" && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3B82F6", display: "inline-block" }} />}
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text)" }}>Live Network Loss</span>
              {run.status === "training" && <span style={{ background: "var(--surface-2)", border: "1px solid var(--accent)33", color: "var(--accent)", fontSize: 10, padding: "1px 7px", borderRadius: 3, fontFamily: "monospace" }}>Training…</span>}
              {run.status === "paused"   && <span style={{ background: "var(--surface-2)", border: "1px solid #3B82F633", color: "#3B82F6", fontSize: 10, padding: "1px 7px", borderRadius: 3, fontFamily: "monospace" }}>Paused</span>}
            </div>

            <div style={{ height: 160, position: "relative", marginBottom: 4 }}>
              <svg viewBox="0 0 800 200" preserveAspectRatio="none" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
                {[40, 80, 120, 160].map(y => <line key={y} x1="0" y1={y} x2="800" y2={y} stroke="var(--border)" strokeWidth="1" />)}
                {chartPoints ? (
                  <polyline fill="none" stroke="#3B82F6" strokeWidth="3" strokeLinejoin="round" points={chartPoints} vectorEffect="non-scaling-stroke" />
                ) : (
                  <text x="400" y="100" textAnchor="middle" fill="var(--text-muted)" fontSize="14" fontFamily="monospace">
                    {run.status === "idle" ? "Not started" : "Waiting for first epoch…"}
                  </text>
                )}
                {liveDot && <circle cx={liveDot.cx} cy={liveDot.cy} r="5" fill="#3B82F6" />}
              </svg>
              <div style={{ position: "absolute", bottom: 0, left: 0, fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace" }}>Epoch 0</div>
              <div style={{ position: "absolute", bottom: 0, right: 0, fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace" }}>Epoch {run.epochs}</div>
            </div>

            <div style={{ paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Training Progress</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", fontFamily: "monospace" }}>{pct}%</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: "var(--border)" }}>
                  <div style={{ height: "100%", borderRadius: 2, width: `${pct}%`, background: "var(--accent)", transition: "width 0.8s ease" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 20, flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase" }}>Current Epoch</div>
                  <div style={{ fontSize: 16, fontFamily: "monospace", color: "var(--text)" }}>{currentEpoch}/{totalEpochs}</div>
                </div>
                {progress?.loss != null && (
                  <div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase" }}>Box Loss</div>
                    <div style={{ fontSize: 16, fontFamily: "monospace", color: "#F97316" }}>{progress.loss.toFixed(4)}</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Terminal log */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#0e0e0e" }}>
            <div style={{ padding: "6px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, background: "var(--surface)" }}>
              <Terminal size={12} style={{ color: "var(--text-muted)" }} />
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)" }}>Training Logs — {run.name}</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", fontFamily: "monospace", fontSize: 11, lineHeight: 1.6 }}>
              {lines.length === 0
                ? <div style={{ color: "var(--text-muted)", paddingTop: 16 }}>No log entries yet.</div>
                : lines.map((line, i) => <LogLine key={i} line={line} />)
              }
              <div ref={logEndRef} />
            </div>
          </div>
        </div>

        {/* Right: metrics */}
        <div style={{ display: "flex", flexDirection: "column", overflowY: "auto", padding: 16, gap: 12 }}>

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", marginBottom: 12 }}>Real-time Validation</div>
            {([["mAP @ .50", mAP50], ["mAP @ .50:.95", mAP5095], ["Precision", progress?.mAP ?? null], ["Recall", null]] as [string, number | null][]).map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 4, background: "var(--bg)", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
                <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: value != null ? "var(--accent)" : "var(--text-muted)" }}>{value != null ? value.toFixed(3) : "—"}</span>
              </div>
            ))}
          </div>

          {(progress?.ramMB != null || progress?.gpuMB != null) && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", marginBottom: 12 }}>Memory</div>
              {progress?.ramMB != null && <MemoryBar label="RAM" valueMB={progress.ramMB} peakMB={peakRamMB ?? progress.ramMB} color="var(--accent)" />}
              {progress?.gpuMB != null && <MemoryBar label="GPU" valueMB={progress.gpuMB} peakMB={peakGpuMB ?? progress.gpuMB} color="#A78BFA" />}
            </div>
          )}

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", marginBottom: 12 }}>Run Configuration</div>
            {([["Model", run.baseModel], ["Epochs", String(run.epochs)], ["Batch", run.batchSize === -1 ? "auto" : String(run.batchSize)], ["Image Size", `${run.imgsz}px`], ["Device", run.device]] as [string, string][]).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{k}</span>
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text)" }}>{v}</span>
              </div>
            ))}
          </div>

          {runMeta?.found && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", marginBottom: 12 }}>Dataset</div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Annotated images</span>
                <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, color: "var(--text)" }}>{runMeta.imageCount}</span>
              </div>
              {(runMeta.newCount > 0 || runMeta.modifiedCount > 0) && (
                <div style={{ fontSize: 11, color: "#F59E0B", marginBottom: 8, lineHeight: 1.5 }}>
                  {runMeta.newCount > 0 && <div>+{runMeta.newCount} new since this run</div>}
                  {runMeta.modifiedCount > 0 && <div>~{runMeta.modifiedCount} modified since this run</div>}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Classes</span>
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text)" }}>{runMeta.classMap.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                {runMeta.classMap.map((cls, i) => (
                  <div key={cls} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: CLASS_COLORS[i % CLASS_COLORS.length] }} />
                    <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cls}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", marginBottom: 8 }}>Output</div>
            <div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", wordBreak: "break-all", lineHeight: 1.5 }}>{run.outputPath}</div>
          </div>

        </div>
      </div>
    </div>
  );
}
