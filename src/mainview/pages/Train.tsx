import { useState } from "react";
import { Plus, MoreHorizontal, FolderOpen, Cpu } from "lucide-react";
import { type TrainingRun, type Asset } from "../lib/types";
import { RUN_STATUS_LABELS, RUN_STATUS_COLORS, BASE_MODELS, DEVICES, CLASS_COLORS } from "../lib/constants";
import { getRPC } from "../lib/rpc";

interface Props {
  assets: Asset[];
  runs: TrainingRun[];
  onRunsChange: (runs: TrainingRun[]) => void;
}

export default function Train({ assets, runs, onRunsChange }: Props) {
  const [showModal, setShowModal] = useState(false);

  function handleCreate(run: TrainingRun) {
    onRunsChange([...runs, run]);
    setShowModal(false);
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>

      {/* Header */}
      <div style={{ padding: "24px 28px 20px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.4px", marginBottom: 3 }}>
              Train
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Configure and launch training runs from your assets.
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "8px 14px", borderRadius: 7, border: "none",
              background: "var(--accent)", color: "#fff",
              fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <Plus size={14} /> New Run
          </button>
        </div>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>

          {runs.map(run => (
            <RunCard key={run.id} run={run} assets={assets} />
          ))}

          <button
            onClick={() => setShowModal(true)}
            style={{
              background: "var(--surface)", border: "1px dashed var(--border)",
              borderRadius: 8, minHeight: 220, cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 10, color: "var(--text-muted)", transition: "border-color 0.15s, color 0.15s",
              fontFamily: "inherit",
            }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = "var(--accent)"; el.style.color = "var(--accent)"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = "var(--border)";  el.style.color = "var(--text-muted)"; }}
          >
            <div style={{ width: 36, height: 36, borderRadius: "50%", border: "1.5px dashed currentColor", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Plus size={16} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>New Training Run</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Select assets and configure training</div>
            </div>
          </button>

        </div>
      </div>

      {showModal && (
        <NewRunModal assets={assets} onClose={() => setShowModal(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}

// ── RunCard ────────────────────────────────────────────────────────────────────

function RunCard({ run, assets }: { run: TrainingRun; assets: Asset[] }) {
  const statusColor = RUN_STATUS_COLORS[run.status];
  const statusLabel = RUN_STATUS_LABELS[run.status];
  const runAssets   = assets.filter(a => run.assetIds.includes(a.id));

  return (
    <div
      style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 8, overflow: "hidden", cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "#444"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"; }}
    >
      {/* Header band */}
      <div style={{
        height: 6,
        background: statusColor,
        opacity: run.status === "idle" ? 0.4 : 1,
      }} />

      <div style={{ padding: "14px 14px 12px" }}>
        {/* Run name + menu */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.2px", fontFamily: "monospace" }}>
            {run.name}
          </h3>
          <button
            onClick={e => e.stopPropagation()}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0 0 0 8px" }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>

        {/* Status + model */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
          <span style={{
            padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 600,
            background: statusColor + "22", border: `1px solid ${statusColor}55`, color: statusColor,
            letterSpacing: "0.04em", textTransform: "uppercase",
          }}>
            {statusLabel}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
            <Cpu size={11} /> {run.baseModel}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
            {run.epochs}ep · {run.batchSize === -1 ? "auto" : `b${run.batchSize}`} · {run.imgsz}px
          </span>
          {run.mAP != null && (
            <span style={{ fontSize: 12, color: "var(--text)", fontFamily: "monospace", marginLeft: "auto" }}>
              mAP {run.mAP.toFixed(3)}
            </span>
          )}
        </div>

        {/* Assets used */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            Assets
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {runAssets.map((a, i) => (
              <span key={a.id} style={{
                fontSize: 11, padding: "2px 7px", borderRadius: 4,
                background: CLASS_COLORS[i % CLASS_COLORS.length] + "22",
                color: CLASS_COLORS[i % CLASS_COLORS.length],
                border: `1px solid ${CLASS_COLORS[i % CLASS_COLORS.length]}44`,
                fontWeight: 500,
              }}>{a.name}</span>
            ))}
          </div>
        </div>

        {/* Classes count */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {run.classMap.length} classes: <span style={{ color: "var(--text)", fontFamily: "monospace" }}>
              {run.classMap.slice(0, 3).join(", ")}{run.classMap.length > 3 ? ` +${run.classMap.length - 3}` : ""}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div style={{ paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <div style={{
            fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4,
          }}
            title={run.outputPath}
          >
            <FolderOpen size={10} style={{ display: "inline", marginRight: 4, verticalAlign: "middle" }} />
            {run.outputPath}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Updated {run.updatedAt}</div>
        </div>
      </div>
    </div>
  );
}

// ── NewRunModal ────────────────────────────────────────────────────────────────

const DEFAULT_EPOCHS    = 100;
const DEFAULT_BATCH     = 16;
const DEFAULT_IMGSZ     = 640;
const DEFAULT_DEVICE    = "auto";

function NewRunModal({ assets, onClose, onCreate }: {
  assets: Asset[];
  onClose: () => void;
  onCreate: (run: TrainingRun) => void;
}) {
  const [name, setName]                     = useState("");
  const [nameEdited, setNameEdited]         = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [baseModel, setBaseModel]           = useState(BASE_MODELS[0]);
  const [epochs, setEpochs]                 = useState(DEFAULT_EPOCHS);
  const [batchSize, setBatchSize]           = useState(DEFAULT_BATCH);
  const [imgsz, setImgsz]                   = useState(DEFAULT_IMGSZ);
  const [device, setDevice]                 = useState(DEFAULT_DEVICE);
  const [outputPath, setOutputPath]         = useState("");
  const [outputEdited, setOutputEdited]     = useState(false);
  const [picking, setPicking]               = useState(false);

  // Build merged class list (preserving insertion order, deduplicating)
  const classMap = [...new Map(
    assets
      .filter(a => selectedAssets.includes(a.id))
      .flatMap(a => a.classes)
      .map(c => [c, c])
  ).keys()];

  // Auto-suggest run name from first selected asset + model when user hasn't typed one.
  function toggleAsset(id: string) {
    setSelectedAssets(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      if (!nameEdited) {
        const first = assets.find(a => next[0] === a.id);
        const suggested = first
          ? `${first.name.toLowerCase().replace(/\s+/g, "-")}-${baseModel}-v1`
          : "";
        setName(suggested);
        if (!outputEdited) setOutputPath(suggested ? `~/.yolostudio/runs/${suggested}` : "");
      }
      return next;
    });
  }

  // Sync output path when name changes (unless user has manually edited it).
  function handleNameChange(val: string) {
    setName(val);
    setNameEdited(true);
    if (!outputEdited) {
      setOutputPath(val.trim() ? `~/.yolostudio/runs/${val.trim()}` : "");
    }
  }

  async function pickFolder() {
    setPicking(true);
    try {
      const { canceled, path } = await getRPC().request.openFolderPathDialog({});
      if (!canceled && path) { setOutputPath(path); setOutputEdited(true); }
    } finally {
      setPicking(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || selectedAssets.length === 0 || !outputPath.trim()) return;
    onCreate({
      id:         crypto.randomUUID(),
      name:       name.trim(),
      assetIds:   selectedAssets,
      classMap,
      baseModel,
      epochs,
      batchSize,
      imgsz,
      device,
      outputPath: outputPath.trim(),
      status:     "idle",
      updatedAt:  "just now",
    });
  }

  const valid = name.trim() && selectedAssets.length > 0 && outputPath.trim();

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 500, background: "var(--surface)", borderRadius: 10,
        border: "1px solid var(--border)", padding: "24px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)", maxHeight: "90vh", overflowY: "auto",
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 20, letterSpacing: "-0.3px" }}>
          New Training Run
        </h2>

        {assets.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 13 }}>
            No assets yet. Create and annotate an asset first.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Run name */}
            <Field label="Run Name">
              <input
                autoFocus
                value={name}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="e.g. vehicles-yolo11n-v1"
                style={{ ...inputStyle, fontFamily: "monospace" }}
              />
            </Field>

            {/* Assets */}
            <Field label="Assets">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {assets.map(a => {
                  const selected  = selectedAssets.includes(a.id);
                  const annotated = a.annotatedCount;
                  const total     = a.imageCount;
                  const ready     = annotated > 0;
                  return (
                    <label
                      key={a.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 10px", borderRadius: 6, cursor: "pointer",
                        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                        background: selected ? "rgba(59,130,246,0.06)" : "var(--bg)",
                        transition: "border-color 0.12s, background 0.12s",
                        opacity: ready ? 1 : 0.5,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!ready}
                        onChange={() => toggleAsset(a.id)}
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{a.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {annotated}/{total} annotated · {a.classes.length} classes
                          {!ready && <span style={{ color: "#EF4444", marginLeft: 6 }}>— no annotations</span>}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </Field>

            {/* Class map preview */}
            {classMap.length > 0 && (
              <div style={{ padding: "10px 12px", borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                  Merged class map · {classMap.length} classes
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {classMap.map((cls, i) => (
                    <span key={cls} style={{
                      fontSize: 10, padding: "2px 6px", borderRadius: 3,
                      background: CLASS_COLORS[i % CLASS_COLORS.length] + "22",
                      color: CLASS_COLORS[i % CLASS_COLORS.length],
                      border: `1px solid ${CLASS_COLORS[i % CLASS_COLORS.length]}44`,
                      fontFamily: "monospace",
                    }}>
                      {i}: {cls}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Base model */}
            <Field label="Base Model">
              <select
                value={baseModel}
                onChange={e => setBaseModel(e.target.value)}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                {BASE_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>

            {/* Hyperparameters */}
            <Field label="Hyperparameters">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <NumField label="Epochs"     value={epochs}    min={1}   max={10000} onChange={setEpochs} />
                <NumField label="Batch Size" value={batchSize} min={-1}  max={1024}  onChange={setBatchSize} hint="-1 = auto" />
                <NumField label="Image Size" value={imgsz}     min={32}  max={1280}  onChange={setImgsz} />
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Device</div>
                  <select
                    value={device}
                    onChange={e => setDevice(e.target.value)}
                    style={{ ...inputStyle, cursor: "pointer", padding: "6px 10px" }}
                  >
                    {DEVICES.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
            </Field>

            {/* Output folder */}
            <Field label="Output Folder">
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={outputPath}
                  onChange={e => { setOutputPath(e.target.value); setOutputEdited(true); }}
                  placeholder="~/.yolostudio/runs/my-run"
                  style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: 11 }}
                />
                <button
                  type="button"
                  onClick={pickFolder}
                  disabled={picking}
                  style={{
                    padding: "0 12px", borderRadius: 6, border: "1px solid var(--border)",
                    background: "var(--surface-2)", color: "var(--text-muted)",
                    cursor: picking ? "not-allowed" : "pointer", fontSize: 12, fontFamily: "inherit",
                    display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                  }}
                >
                  <FolderOpen size={13} /> Browse
                </button>
              </div>
            </Field>

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: 1, padding: "9px", borderRadius: 7,
                  border: "1px solid var(--border)", background: "transparent",
                  color: "var(--text-muted)", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!valid}
                style={{
                  flex: 1, padding: "9px", borderRadius: 7, border: "none",
                  background: valid ? "var(--accent)" : "var(--border)",
                  color: valid ? "#fff" : "var(--text-muted)",
                  fontSize: 13, fontWeight: 600,
                  cursor: valid ? "pointer" : "not-allowed", fontFamily: "inherit",
                }}
              >
                Create Run
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function NumField({ label, value, min, max, onChange, hint }: {
  label: string; value: number; min: number; max: number;
  onChange: (v: number) => void; hint?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
        {label}{hint && <span style={{ opacity: 0.6, marginLeft: 4 }}>({hint})</span>}
      </div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={e => onChange(Number(e.target.value))}
        style={{ ...inputStyle, padding: "6px 10px" }}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "var(--text-muted)", marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 6,
  border: "1px solid var(--border)", background: "var(--bg)",
  color: "var(--text)", fontSize: 13, fontFamily: "inherit",
  outline: "none", boxSizing: "border-box",
};
