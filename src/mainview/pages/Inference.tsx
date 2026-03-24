import { useState, useEffect, useRef } from "react";
import { Upload, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { type TrainingRun } from "../lib/types";
import { CLASS_COLORS } from "../lib/constants";
import { getRPC, getBridgeUrl } from "../lib/rpc";
import CustomSelect from "../components/CustomSelect";

// ── types ──────────────────────────────────────────────────────────────────────

interface Detection {
  classIndex: number;
  label:      string;
  confidence: number;
  cx: number; cy: number; w: number; h: number;
}

interface Props {
  runs: TrainingRun[];
}

// ── letterbox coordinate helper ────────────────────────────────────────────────
// Maps a normalized (0-1) detection box to absolute px coords within the
// viewport container, accounting for object-fit: contain letterboxing.

function letterboxRect(
  det: Detection,
  imgW: number, imgH: number,
  vpW:  number, vpH:  number,
): { left: number; top: number; width: number; height: number } {
  const scale     = Math.min(vpW / imgW, vpH / imgH);
  const renderedW = imgW * scale;
  const renderedH = imgH * scale;
  const offsetX   = (vpW - renderedW) / 2;
  const offsetY   = (vpH - renderedH) / 2;

  const bw = det.w  * renderedW;
  const bh = det.h  * renderedH;
  return {
    left:   offsetX + det.cx * renderedW - bw / 2,
    top:    offsetY + det.cy * renderedH - bh / 2,
    width:  bw,
    height: bh,
  };
}

// ── component ─────────────────────────────────────────────────────────────────

export default function Inference({ runs }: Props) {
  const doneRuns = runs.filter(r => r.status === "done");

  const [selectedRunId, setSelectedRunId] = useState<string | null>(doneRuns[0]?.id ?? null);
  const [imagePath,     setImagePath]     = useState<string | null>(null);
  const [naturalSize,   setNaturalSize]   = useState<{ w: number; h: number } | null>(null);
  const [vpSize,        setVpSize]        = useState<{ w: number; h: number } | null>(null);
  const [confidence,    setConfidence]    = useState(0.5);
  const [debouncedConf, setDebouncedConf] = useState(0.5);
  const [detections,    setDetections]    = useState<Detection[]>([]);
  const [inferenceMs,   setInferenceMs]   = useState<number | null>(null);
  const [inferring,     setInferring]     = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [hiddenClasses, setHiddenClasses] = useState<Set<number>>(new Set());
  const [zoom,          setZoom]          = useState(1);

  const viewportRef  = useRef<HTMLDivElement>(null);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedRun = doneRuns.find(r => r.id === selectedRunId) ?? null;

  // Auto-select first done run when list changes.
  useEffect(() => {
    if (!selectedRunId && doneRuns.length > 0) setSelectedRunId(doneRuns[0].id);
  }, [runs]);

  // Track viewport container size for letterbox math.
  useEffect(() => {
    if (!viewportRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setVpSize({ w: width, h: height });
    });
    ro.observe(viewportRef.current);
    return () => ro.disconnect();
  }, []);

  // Cleanup debounce on unmount.
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // Re-run inference when image, model, or (debounced) confidence changes.
  useEffect(() => {
    if (!imagePath || !selectedRun) return;
    doInference(imagePath, selectedRun.outputPath, debouncedConf);
  }, [imagePath, selectedRunId, debouncedConf]);

  async function doInference(imgPath: string, outputPath: string, conf: number) {
    setInferring(true);
    setError(null);
    try {
      const res = await getRPC().request.runInference({ imagePath: imgPath, outputPath, confidence: conf });
      if (res.error) {
        setError(res.error);
        setDetections([]);
      } else {
        setDetections(res.detections);
        setInferenceMs(res.inferenceMs);
        setHiddenClasses(new Set()); // reset class filter on fresh results
      }
    } catch (e) {
      setError(String(e));
      setDetections([]);
    } finally {
      setInferring(false);
    }
  }

  async function handleLoadImage() {
    const res = await getRPC().request.openImagesDialog({});
    if (res.canceled || !res.paths[0]) return;
    setImagePath(res.paths[0]);
    setDetections([]);
    setInferenceMs(null);
    setNaturalSize(null);
    setError(null);
    setZoom(1);
  }

  function handleConfidenceChange(v: number) {
    setConfidence(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedConf(v), 400);
  }

  function handleSelectRun(id: string) {
    setSelectedRunId(id);
    setDetections([]);
    setInferenceMs(null);
    setError(null);
  }

  function toggleClass(idx: number) {
    setHiddenClasses(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  const imageSrc          = imagePath ? getBridgeUrl(imagePath) : null;
  const visibleDetections = detections.filter(d => !hiddenClasses.has(d.classIndex));

  // Status bar state
  const statusColor = error ? "#EF4444" : inferring ? "#F97316" : imageSrc ? "#22C55E" : "#6B7280";
  const statusLabel = error ? "Error" : inferring ? "Running…" : imageSrc ? "Ready" : "Idle";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ height: 56, padding: "0 28px", display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>Inference</span>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: "flex", gap: 16, padding: 16, overflow: "hidden" }}>

        {/* ── Left: image area ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>

          {/* Controls bar */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
            padding: "0 16px", height: 48, display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
          }}>
            <button
              onClick={handleLoadImage}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "6px 14px", borderRadius: 6, border: "1px solid var(--border)",
                background: "var(--bg)", color: "var(--text)", fontSize: 13, fontWeight: 500,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <Upload size={14} /> Load Image
            </button>

            <div style={{ width: 1, height: 20, background: "var(--border)" }} />

            {selectedRun ? (
              <>
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>
                  {selectedRun.baseModel}
                </span>
                <span style={{
                  padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                  background: "#3B82F622", border: "1px solid #3B82F655",
                  color: "var(--accent)", letterSpacing: "0.06em", textTransform: "uppercase",
                }}>
                  {selectedRun.name}
                </span>
              </>
            ) : (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>No model selected</span>
            )}
          </div>

          {/* Viewport */}
          <div
            ref={viewportRef}
            style={{
              flex: 1, position: "relative", background: "#111", borderRadius: 10,
              overflow: "hidden", border: "1px solid var(--border)",
            }}
          >
            {imageSrc ? (
              <>
                {/* Image */}
                <img
                  src={imageSrc}
                  onLoad={e => setNaturalSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                  style={{
                    width: "100%", height: "100%", objectFit: "contain",
                    transform: `scale(${zoom})`, transformOrigin: "center center",
                    transition: "transform 0.15s",
                  }}
                />

                {/* Bounding boxes — only when size is known */}
                {naturalSize && vpSize && visibleDetections.map((det, i) => {
                  const rect  = letterboxRect(det, naturalSize.w, naturalSize.h, vpSize.w, vpSize.h);
                  const color = CLASS_COLORS[det.classIndex % CLASS_COLORS.length];
                  return (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left:   rect.left,   top:    rect.top,
                        width:  rect.width,  height: rect.height,
                        border: `2px solid ${color}`,
                        background: `${color}18`,
                        borderRadius: 2,
                        boxSizing: "border-box",
                        pointerEvents: "none",
                      }}
                    >
                      <div style={{
                        position: "absolute", top: -22, left: -2,
                        background: color, padding: "1px 6px",
                        borderRadius: "2px 2px 0 0",
                        fontSize: 10, fontFamily: "monospace", fontWeight: 700,
                        color: "#fff", whiteSpace: "nowrap",
                      }}>
                        {det.label} {det.confidence.toFixed(2)}
                      </div>
                    </div>
                  );
                })}

                {/* Running overlay */}
                {inferring && (
                  <div style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center",
                    justifyContent: "center", background: "rgba(0,0,0,0.55)",
                  }}>
                    <span style={{ fontSize: 13, color: "#fff", fontFamily: "monospace" }}>Running inference…</span>
                  </div>
                )}
              </>
            ) : (
              /* Empty state */
              <div
                onClick={handleLoadImage}
                style={{
                  position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 10, cursor: "pointer",
                }}
              >
                <Upload size={32} color="var(--border)" strokeWidth={1.5} />
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Click to load an image</span>
                {!selectedRun && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)", opacity: 0.6 }}>
                    Select a trained model first →
                  </span>
                )}
              </div>
            )}

            {/* Floating toolbar */}
            {imageSrc && (
              <div style={{
                position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
                display: "flex", alignItems: "center", gap: 4,
                background: "rgba(20,20,20,0.85)", backdropFilter: "blur(8px)",
                padding: "6px 10px", borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.08)",
              }}>
                <ToolBtn title="Zoom in"  onClick={() => setZoom(z => Math.min(z + 0.25, 4))}><ZoomIn  size={16} /></ToolBtn>
                <ToolBtn title="Zoom out" onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))}><ZoomOut size={16} /></ToolBtn>
                <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.15)", margin: "0 2px" }} />
                <ToolBtn title="Reset zoom" onClick={() => setZoom(1)}><Maximize2 size={16} /></ToolBtn>
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div style={{ width: 272, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>

          {/* Model selector */}
          <Panel label="Model">
            {doneRuns.length === 0 ? (
              <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                No trained models yet.<br />Complete a training run first.
              </span>
            ) : (
              <CustomSelect
                value={selectedRunId ?? ""}
                options={doneRuns.map(run => ({ value: run.id, label: run.name + (run.mAP != null ? `  (mAP ${run.mAP.toFixed(2)})` : "") }))}
                onChange={handleSelectRun}
                fontSize={12}
                mono
              />
            )}
          </Panel>

          {/* Confidence threshold */}
          <Panel label={`Confidence Threshold`} value={confidence.toFixed(2)}>
            <input
              type="range"
              min={0.01} max={0.99} step={0.01}
              value={confidence}
              disabled={inferring}
              onChange={e => handleConfidenceChange(parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "var(--accent)", cursor: inferring ? "not-allowed" : "pointer" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>0.0</span>
              <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>1.0</span>
            </div>
          </Panel>

          {/* Detected objects */}
          <div style={{
            flex: 1, background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "14px 16px", minHeight: 120,
            display: "flex", flexDirection: "column",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)" }}>
                Detected Objects
              </span>
              <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>
                {visibleDetections.length}
              </span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {visibleDetections.length === 0 && !inferring && (
                <span style={{ fontSize: 12, color: "var(--text-muted)", opacity: 0.7 }}>
                  {imageSrc ? "No detections above threshold." : "Load an image to see detections."}
                </span>
              )}
              {visibleDetections.map((det, i) => {
                const color = CLASS_COLORS[det.classIndex % CLASS_COLORS.length];
                const area  = (det.w * det.h * 100).toFixed(1);
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 10px", borderRadius: 7,
                      background: "var(--bg)", border: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{det.label}</div>
                        <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>
                          Area: {area}%
                        </div>
                      </div>
                    </div>
                    <span style={{ fontSize: 12, fontFamily: "monospace", color, fontWeight: 600 }}>
                      {det.confidence.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Classes to filter */}
          {selectedRun && selectedRun.classMap.length > 0 && (
            <Panel label="Classes to Filter">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {selectedRun.classMap.map((cls, idx) => {
                  const hidden  = hiddenClasses.has(idx);
                  const color   = CLASS_COLORS[idx % CLASS_COLORS.length];
                  const hasHits = detections.some(d => d.classIndex === idx);
                  return (
                    <button
                      key={idx}
                      onClick={() => toggleClass(idx)}
                      title={hidden ? "Show" : "Hide"}
                      style={{
                        padding: "3px 10px", borderRadius: 999, border: "none",
                        background: hidden ? "var(--bg)" : color + "33",
                        color:      hidden ? "var(--text-muted)" : color,
                        outline:    `1px solid ${hidden ? "var(--border)" : color + "66"}`,
                        fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                        opacity: hasHits || !imageSrc ? 1 : 0.45,
                      }}
                    >
                      {cls}
                    </button>
                  );
                })}
              </div>
            </Panel>
          )}
        </div>
      </div>

      {/* ── Status bar ── */}
      <div style={{
        height: 36, background: "var(--surface)", borderTop: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: statusColor, display: "inline-block",
              boxShadow: inferring ? `0 0 0 2px ${statusColor}44` : "none",
            }} />
            <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {statusLabel}
            </span>
          </div>
          {error && (
            <span style={{ fontSize: 11, color: "#EF4444", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {error}
            </span>
          )}
          {!error && inferenceMs != null && (
            <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>
              Inference: <span style={{ color: "var(--text)" }}>{inferenceMs}ms</span>
            </span>
          )}
        </div>
        {naturalSize && (
          <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>
            {naturalSize.w} × {naturalSize.h}
          </span>
        )}
      </div>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

function Panel({ label, value, children }: {
  label: string; value?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)" }}>
          {label}
        </span>
        {value && (
          <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--accent)" }}>{value}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function ToolBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, border: "none", background: "none",
        color: "rgba(255,255,255,0.7)", cursor: "pointer", borderRadius: 6,
      }}
      onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
      onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
    >
      {children}
    </button>
  );
}
