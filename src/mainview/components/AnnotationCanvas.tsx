import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { type BBox, type ClassDef, type AnnotateTool } from "../lib/annotationTypes";
import {
  canvasToImagePoint,
  annotationToCanvasPoints,
  CANVAS_BG,
  clampCanvasPointToImage,
  drawBox,
  drawPolygon,
  imageToCanvasRect,
  POLYGON_CLOSE_RADIUS,
  ZOOM_BTN,
  ZOOM_MAX,
  ZOOM_MIN,
} from "./annotationCanvasUtils";
import { useAnnotationCanvasInteractions } from "./useAnnotationCanvasInteractions";

interface Props {
  tool: AnnotateTool;
  classes: ClassDef[];
  activeClassIndex: number;
  annotations: BBox[];
  selectedId: string | null;
  imageSrc: string | null;
  onAnnotationsChange: (anns: BBox[]) => void;
  onSelect: (id: string | null) => void;
  onZoomChange: (z: number) => void;
  onCoordsChange: (x: number, y: number) => void;
}

export interface CanvasHandle {
  fitImage: () => void;
  zoomIn:   () => void;
  zoomOut:  () => void;
}

// ── component ─────────────────────────────────────────────────────────────────

const AnnotationCanvas = forwardRef<CanvasHandle, Props>(function AnnotationCanvas(
  { tool, classes, activeClassIndex, annotations, selectedId, imageSrc,
    onAnnotationsChange, onSelect, onZoomChange, onCoordsChange },
  ref,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const imageRef   = useRef<HTMLImageElement | null>(null);
  const imgSizeRef = useRef({ w: 640, h: 480 });
  const didFitRef  = useRef(false);

  const scaleRef  = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });

  // box drawing state
  const isDrawingRef = useRef(false);
  const drawStartRef = useRef({ x: 0, y: 0 });
  const drawEndRef   = useRef({ x: 0, y: 0 });

  // hand tool drag state
  const dragModeRef     = useRef<"none" | "pan" | "move" | "resize" | "vertex">("none");
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const dragAnnIdRef    = useRef<string | null>(null);
  const dragAnnOrigRef  = useRef<BBox | null>(null);
  const resizeCornerRef   = useRef<number>(0);
  const dragVertexIndexRef = useRef<number>(-1);
  const previewAnnRef   = useRef<BBox | null>(null);

  const spaceDownRef = useRef(false);

  // polygon drawing state: points stored as normalized image coords [0,1]
  const polygonPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  // current mouse position in canvas coords for the preview line
  const polygonMouseRef  = useRef<{ x: number; y: number } | null>(null);

  // ── stable prop refs (avoid re-attaching listeners on every parent render) ──
  const annotationsRef      = useRef(annotations);
  const selectedIdRef       = useRef(selectedId);
  const toolRef             = useRef(tool);
  const classesRef          = useRef(classes);
  const activeClassIndexRef = useRef(activeClassIndex);
  const onZoomChangeRef     = useRef(onZoomChange);
  const onAnnotationsChangeRef = useRef(onAnnotationsChange);
  const onSelectRef            = useRef(onSelect);
  const onCoordsChangeRef      = useRef(onCoordsChange);

  annotationsRef.current         = annotations;
  selectedIdRef.current          = selectedId;
  toolRef.current                = tool;
  classesRef.current             = classes;
  activeClassIndexRef.current    = activeClassIndex;
  onZoomChangeRef.current        = onZoomChange;
  onAnnotationsChangeRef.current = onAnnotationsChange;
  onSelectRef.current            = onSelect;
  onCoordsChangeRef.current      = onCoordsChange;

  // ── coordinate helpers ────────────────────────────────────────────────────

  function canvasPos(e: MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function clampToImage(pos: { x: number; y: number }) {
    return clampCanvasPointToImage(pos, imgSizeRef.current, {
      scale: scaleRef.current,
      offset: offsetRef.current,
    });
  }

  function canvasToImage(cx: number, cy: number) {
    return canvasToImagePoint({ x: cx, y: cy }, {
      scale: scaleRef.current,
      offset: offsetRef.current,
    });
  }

  function yoloToCanvas(cx: number, cy: number, w: number, h: number) {
    return imageToCanvasRect({ cx, cy, w, h }, imgSizeRef.current, {
      scale: scaleRef.current,
      offset: offsetRef.current,
    });
  }

  function imageToYolo(ix: number, iy: number, iw2: number, ih2: number) {
    const { w: iw, h: ih } = imgSizeRef.current;
    return {
      cx: (ix + iw2 / 2) / iw,
      cy: (iy + ih2 / 2) / ih,
      w:  iw2 / iw,
      h:  ih2 / ih,
    };
  }

  function annToCanvasPts(ann: BBox): Array<{ x: number; y: number }> | null {
    return annotationToCanvasPoints(
      ann,
      imgSizeRef.current,
      { scale: scaleRef.current, offset: offsetRef.current },
    );
  }

  // ── redraw ────────────────────────────────────────────────────────────────

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const { width: cw, height: ch } = canvas;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, cw, ch);

    const img = imageRef.current;
    const { w: iw, h: ih } = imgSizeRef.current;
    const sc = scaleRef.current;
    const { x: ox, y: oy } = offsetRef.current;

    if (img) ctx.drawImage(img, ox, oy, iw * sc, ih * sc);

    const anns    = annotationsRef.current;
    const cls     = classesRef.current;
    const preview = previewAnnRef.current;
    const selId   = selectedIdRef.current;

    for (const ann of anns) {
      const display = (preview && ann.id === preview.id) ? preview : ann;
      const color   = cls[display.classIndex]?.color ?? "#3B82F6";
      const label   = cls[display.classIndex]?.name  ?? "?";
      const canvasPts = annToCanvasPts(display);
      if (canvasPts) {
        drawPolygon(ctx, canvasPts, color, label, display.id === selId);
      } else {
        const rect = yoloToCanvas(display.cx, display.cy, display.w, display.h);
        drawBox(ctx, rect, color, label, display.id === selId);
      }
    }

    // in-progress polygon preview
    const polyPts = polygonPointsRef.current;
    if (polyPts.length > 0) {
      const color    = cls[activeClassIndexRef.current]?.color ?? "#3B82F6";
      const mouse    = polygonMouseRef.current;
      const canClose = polyPts.length >= 3;
      const canvasPts = polyPts.map(p => ({
        x: p.x * iw * sc + ox,
        y: p.y * ih * sc + oy,
      }));
      const isHoverClose = canClose && mouse !== null &&
        Math.sqrt((mouse.x - canvasPts[0].x) ** 2 + (mouse.y - canvasPts[0].y) ** 2) <= POLYGON_CLOSE_RADIUS;

      // draw lines between placed points + preview line to mouse
      ctx.beginPath();
      ctx.moveTo(canvasPts[0].x, canvasPts[0].y);
      for (let i = 1; i < canvasPts.length; i++) ctx.lineTo(canvasPts[i].x, canvasPts[i].y);
      if (mouse) {
        if (isHoverClose) ctx.lineTo(canvasPts[0].x, canvasPts[0].y);
        else              ctx.lineTo(mouse.x, mouse.y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // fill preview when hovering close
      if (isHoverClose && canvasPts.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(canvasPts[0].x, canvasPts[0].y);
        for (let i = 1; i < canvasPts.length; i++) ctx.lineTo(canvasPts[i].x, canvasPts[i].y);
        ctx.closePath();
        ctx.fillStyle = color + "18";
        ctx.fill();
      }

      // vertex dots
      for (let i = 0; i < canvasPts.length; i++) {
        const isFirst = i === 0;
        ctx.beginPath();
        ctx.arc(canvasPts[i].x, canvasPts[i].y, isFirst ? POLYGON_CLOSE_RADIUS / 2 : 4, 0, Math.PI * 2);
        ctx.fillStyle = (isFirst && isHoverClose) ? "#22C55E" : "#fff";
        ctx.fill();
        ctx.strokeStyle = (isFirst && isHoverClose) ? "#22C55E" : color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // box draw preview
    if (isDrawingRef.current) {
      const s = drawStartRef.current;
      const e = drawEndRef.current;
      const color = cls[activeClassIndexRef.current]?.color ?? "#3B82F6";
      const rx = Math.min(s.x, e.x), ry = Math.min(s.y, e.y);
      const rw = Math.abs(e.x - s.x), rh = Math.abs(e.y - s.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.fillStyle = color + "18";
      ctx.fillRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }
  }, []);

  // ── zoom helpers ──────────────────────────────────────────────────────────

  // Single zoom implementation — all zoom paths go through this.
  function applyZoomAtPoint(factor: number, pivotX: number, pivotY: number) {
    const ns = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scaleRef.current * factor));
    offsetRef.current = {
      x: pivotX - (pivotX - offsetRef.current.x) * (ns / scaleRef.current),
      y: pivotY - (pivotY - offsetRef.current.y) * (ns / scaleRef.current),
    };
    scaleRef.current = ns;
    onZoomChangeRef.current(Math.round(ns * 100));
    redraw();
  }

  function applyZoom(factor: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    applyZoomAtPoint(factor, canvas.width / 2, canvas.height / 2);
  }

  function fitImage() {
    const canvas = canvasRef.current;
    if (!canvas || !imageRef.current) return;
    const { width: cw, height: ch } = canvas;
    if (cw === 0 || ch === 0) { requestAnimationFrame(fitImage); return; }
    const { w: iw, h: ih } = imgSizeRef.current;
    const sc = Math.min((cw / iw) * 0.9, (ch / ih) * 0.9);
    scaleRef.current  = sc;
    offsetRef.current = { x: (cw - iw * sc) / 2, y: (ch - ih * sc) / 2 };
    onZoomChangeRef.current(Math.round(sc * 100));
    redraw();
  }

  useImperativeHandle(ref, () => ({
    fitImage,
    zoomIn:  () => applyZoom(ZOOM_BTN),
    zoomOut: () => applyZoom(1 / ZOOM_BTN),
  }));

  // ── resize observer ───────────────────────────────────────────────────────

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const obs = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width  = wrapper.clientWidth;
      canvas.height = wrapper.clientHeight;
      if (imageRef.current && !didFitRef.current) {
        fitImage();
        didFitRef.current = true;
      }
      redraw();
    });
    obs.observe(wrapper);
    return () => obs.disconnect();
  }, [redraw]);

  // ── load image ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!imageSrc) { imageRef.current = null; redraw(); return; }
    didFitRef.current = false;
    const canvas  = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (canvas && wrapper && wrapper.clientWidth > 0) {
      canvas.width  = wrapper.clientWidth;
      canvas.height = wrapper.clientHeight;
    }
    const img = new Image();
    img.onload = () => {
      imageRef.current   = img;
      imgSizeRef.current = { w: img.naturalWidth, h: img.naturalHeight };
      fitImage();
      didFitRef.current = true;
    };
    img.src = imageSrc;
  }, [imageSrc, redraw]);

  useEffect(() => { redraw(); }, [annotations, selectedId, redraw]);

  useAnnotationCanvasInteractions({
    canvasRef,
    annotationsRef,
    selectedIdRef,
    toolRef,
    activeClassIndexRef,
    onAnnotationsChangeRef,
    onSelectRef,
    onCoordsChangeRef,
    imgSizeRef,
    scaleRef,
    offsetRef,
    isDrawingRef,
    drawStartRef,
    drawEndRef,
    dragModeRef,
    dragStartPosRef,
    dragAnnIdRef,
    dragAnnOrigRef,
    resizeCornerRef,
    dragVertexIndexRef,
    previewAnnRef,
    polygonPointsRef,
    polygonMouseRef,
    spaceDownRef,
    redraw,
    canvasPos,
    clampToImage,
    canvasToImage,
    imageToYolo,
    applyZoomAtPoint,
  });

  return (
    <div ref={wrapperRef} style={{ flex: 1, overflow: "hidden", background: CANVAS_BG }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
});

export default AnnotationCanvas;
