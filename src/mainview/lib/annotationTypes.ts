/**
 * Clamp a YOLO box so all four edges stay within [0, 1].
 * The center is preserved; width/height are trimmed where they hit a boundary.
 * Used by draw, move, resize, and inline edit — single source of truth.
 */
export function clampBBox(
  cx: number, cy: number, w: number, h: number,
): Pick<BBox, "cx" | "cy" | "w" | "h"> {
  const left   = Math.max(0, cx - w / 2);
  const right  = Math.min(1, cx + w / 2);
  const top    = Math.max(0, cy - h / 2);
  const bottom = Math.min(1, cy + h / 2);
  return {
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
    w:  right - left,
    h:  bottom - top,
  };
}

export interface BBox {
  id: string;
  classIndex: number;
  // YOLO normalized: cx, cy, w, h (0–1)
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface ClassDef {
  name: string;
  color: string;
}

export interface ImageEntry {
  id: string;
  filename: string;
  src: string;        // blob URL or data URL — empty string until lazily loaded
  filePath?: string;  // absolute FS path (for bridge-served images from native dialog)
  annotations: BBox[];
  flagged?: boolean;
}

export type AnnotateTool = "hand" | "box" | "polygon";
