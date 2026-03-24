import { useState, useMemo } from "react";
import { FolderOpen } from "lucide-react";
import Modal from "./Modal";
import { Field, NumField, inputStyle } from "./FormFields";
import CustomSelect from "./CustomSelect";
import { type TrainingRun, type Asset } from "../lib/types";
import { BASE_MODELS, DEVICES, CLASS_COLORS } from "../lib/constants";
import { getRPC } from "../lib/rpc";

const DEFAULT_EPOCHS = 100;
const DEFAULT_BATCH  = 16;
const DEFAULT_IMGSZ  = 640;
const DEFAULT_DEVICE = "auto";

interface Props {
  assets: Asset[];
  runs: TrainingRun[];
  onClose: () => void;
  onCreate: (run: TrainingRun) => void;
}

export default function NewRunModal({ assets, runs, onClose, onCreate }: Props) {
  const [name, setName]             = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [baseModel, setBaseModel]   = useState(BASE_MODELS[0]);
  const [epochs, setEpochs]         = useState(DEFAULT_EPOCHS);
  const [batchSize, setBatchSize]   = useState(DEFAULT_BATCH);
  const [imgsz, setImgsz]           = useState(DEFAULT_IMGSZ);
  const [device, setDevice]         = useState(DEFAULT_DEVICE);
  const [baseFolder, setBaseFolder] = useState("~/.reticle/runs");
  const [picking, setPicking]       = useState(false);

  const nameConflict = name.trim()
    ? [...runs.map(r => r.name), ...assets.map(a => a.name)]
        .some(n => n.toLowerCase() === name.trim().toLowerCase())
    : false;

  const slug       = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const outputPath = slug ? `${baseFolder}/${slug}` : "";

  const classMap = useMemo(() => [...new Map(
    assets.filter(a => selectedAssets.includes(a.id)).flatMap(a => a.classes).map(c => [c, c])
  ).keys()], [assets, selectedAssets]);

  function toggleAsset(id: string) {
    setSelectedAssets(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      if (!nameEdited) {
        const first = assets.find(a => a.id === next[0]);
        setName(first ? `${first.name.toLowerCase().replace(/\s+/g, "-")}-${baseModel}-v1` : "");
      }
      return next;
    });
  }

  async function pickFolder() {
    setPicking(true);
    try {
      const { canceled, path } = await getRPC().request.openFolderPathDialog({});
      if (!canceled && path) setBaseFolder(path);
    } finally {
      setPicking(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!outputPath || selectedAssets.length === 0 || nameConflict) return;
    onCreate({ id: crypto.randomUUID(), name: name.trim(), assetIds: selectedAssets, classMap, baseModel, epochs, batchSize, imgsz, device, outputPath, status: "idle", updatedAt: "just now" });
  }

  const valid = outputPath && selectedAssets.length > 0 && !nameConflict;

  return (
    <Modal width={500} maxHeight="90vh" onClose={onClose}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 20, letterSpacing: "-0.3px" }}>New Training Run</h2>

      {assets.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 13 }}>
          No assets yet. Create and annotate an asset first.
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          <Field label="Run Name">
            <input
              autoFocus value={name}
              onChange={e => { setName(e.target.value); setNameEdited(true); }}
              placeholder="e.g. vehicles-yolo26n-v1"
              style={{ ...inputStyle, fontFamily: "monospace", borderColor: nameConflict ? "#EF4444" : undefined }}
            />
            {nameConflict && <div style={{ fontSize: 11, color: "#EF4444", marginTop: 4 }}>Name already used by a run or asset.</div>}
          </Field>

          <Field label="Assets">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {assets.map(a => {
                const selected = selectedAssets.includes(a.id);
                const ready    = a.annotatedCount > 0;
                return (
                  <div
                    key={a.id}
                    onClick={() => ready && toggleAsset(a.id)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 6, cursor: ready ? "pointer" : "default", border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`, background: selected ? "rgba(59,130,246,0.06)" : "var(--bg)", transition: "border-color 0.12s, background 0.12s", opacity: ready ? 1 : 0.5 }}
                  >
                    <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, border: `1.5px solid ${selected ? "var(--accent)" : "var(--border)"}`, background: selected ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s, border-color 0.15s" }}>
                      {selected && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {a.annotatedCount}/{a.imageCount} annotated · {a.classes.length} classes
                        {!ready && <span style={{ color: "#EF4444", marginLeft: 6 }}>— no annotations</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Field>

          {classMap.length > 0 && (
            <div style={{ padding: "10px 12px", borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Merged class map · {classMap.length} classes</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {classMap.map((cls, i) => (
                  <span key={cls} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: CLASS_COLORS[i % CLASS_COLORS.length] + "22", color: CLASS_COLORS[i % CLASS_COLORS.length], border: `1px solid ${CLASS_COLORS[i % CLASS_COLORS.length]}44`, fontFamily: "monospace" }}>
                    {i}: {cls}
                  </span>
                ))}
              </div>
            </div>
          )}

          <Field label="Base Model">
            <CustomSelect value={baseModel} options={BASE_MODELS} onChange={setBaseModel} />
          </Field>

          <Field label="Hyperparameters">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <NumField label="Epochs"     value={epochs}    min={1}  max={10000} onChange={setEpochs} />
              <NumField label="Batch Size" value={batchSize} min={-1} max={1024}  onChange={setBatchSize} hint="-1 = auto" />
              <NumField label="Image Size" value={imgsz}     min={32} max={1280}  onChange={setImgsz} />
              <div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Device</div>
                <CustomSelect value={device} options={DEVICES} onChange={setDevice} />
              </div>
            </div>
          </Field>

          <Field label="Output Folder">
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>{baseFolder}</div>
              <button type="button" onClick={pickFolder} disabled={picking} style={{ padding: "0 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-muted)", cursor: picking ? "not-allowed" : "pointer", fontSize: 12, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <FolderOpen size={13} /> Browse
              </button>
            </div>
            {slug && <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", marginTop: 5 }}>→ {outputPath}</div>}
          </Field>

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: "9px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <button type="submit" disabled={!valid} style={{ flex: 1, padding: "9px", borderRadius: 7, border: "none", background: valid ? "var(--accent)" : "var(--border)", color: valid ? "#fff" : "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: valid ? "pointer" : "not-allowed", fontFamily: "inherit" }}>Create Run</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
