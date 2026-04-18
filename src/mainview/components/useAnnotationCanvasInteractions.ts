import { useEffect, type MutableRefObject } from "react";
import { type AnnotateTool, type BBox, clampBBox, clampPt, pointsToBbox } from "../lib/annotationTypes";
import { hitAnnotation, hitCorner, hitVertex, MIN_BOX_PX, POLYGON_CLOSE_RADIUS, ZOOM_WHEEL_IN, type ImageSize, type Point } from "./annotationCanvasUtils";

type DragMode = "none" | "pan" | "move" | "resize" | "vertex";

interface Params {
  canvasRef: MutableRefObject<HTMLCanvasElement | null>;
  annotationsRef: MutableRefObject<BBox[]>;
  selectedIdRef: MutableRefObject<string | null>;
  toolRef: MutableRefObject<AnnotateTool>;
  activeClassIndexRef: MutableRefObject<number>;
  onAnnotationsChangeRef: MutableRefObject<(anns: BBox[]) => void>;
  onSelectRef: MutableRefObject<(id: string | null) => void>;
  onCoordsChangeRef: MutableRefObject<(x: number, y: number) => void>;
  imgSizeRef: MutableRefObject<ImageSize>;
  scaleRef: MutableRefObject<number>;
  offsetRef: MutableRefObject<Point>;
  isDrawingRef: MutableRefObject<boolean>;
  drawStartRef: MutableRefObject<Point>;
  drawEndRef: MutableRefObject<Point>;
  dragModeRef: MutableRefObject<DragMode>;
  dragStartPosRef: MutableRefObject<Point>;
  dragAnnIdRef: MutableRefObject<string | null>;
  dragAnnOrigRef: MutableRefObject<BBox | null>;
  resizeCornerRef: MutableRefObject<number>;
  dragVertexIndexRef: MutableRefObject<number>;
  previewAnnRef: MutableRefObject<BBox | null>;
  polygonPointsRef: MutableRefObject<Point[]>;
  polygonMouseRef: MutableRefObject<Point | null>;
  spaceDownRef: MutableRefObject<boolean>;
  redraw: () => void;
  canvasPos: (e: MouseEvent) => Point;
  clampToImage: (pos: Point) => Point;
  canvasToImage: (x: number, y: number) => Point;
  imageToYolo: (ix: number, iy: number, iw: number, ih: number) => Pick<BBox, "cx" | "cy" | "w" | "h">;
  applyZoomAtPoint: (factor: number, pivotX: number, pivotY: number) => void;
}

export function useAnnotationCanvasInteractions({
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
}: Params) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code === "Space") {
        spaceDownRef.current = true;
        event.preventDefault();
      }
      if (event.key === "Escape") {
        isDrawingRef.current = false;
        previewAnnRef.current = null;
        polygonPointsRef.current = [];
        polygonMouseRef.current = null;
        redraw();
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        const selectedId = selectedIdRef.current;
        if (selectedId) {
          onAnnotationsChangeRef.current(annotationsRef.current.filter(annotation => annotation.id !== selectedId));
          onSelectRef.current(null);
        }
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") spaceDownRef.current = false;
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [annotationsRef, isDrawingRef, onAnnotationsChangeRef, onSelectRef, polygonMouseRef, polygonPointsRef, previewAnnRef, redraw, selectedIdRef, spaceDownRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasElement = canvas;

    function transform() {
      return { scale: scaleRef.current, offset: offsetRef.current };
    }

    function finishPolygon() {
      const points = polygonPointsRef.current;
      if (points.length < 3) return;
      const newAnnotation: BBox = {
        id: crypto.randomUUID(),
        classIndex: activeClassIndexRef.current,
        ...pointsToBbox(points),
        points,
      };
      onAnnotationsChangeRef.current([...annotationsRef.current, newAnnotation]);
      onSelectRef.current(newAnnotation.id);
      polygonPointsRef.current = [];
      polygonMouseRef.current = null;
      redraw();
    }

    function getHandCursor(pos: Point): string {
      const annotations = annotationsRef.current;
      const selected = annotations.find(annotation => annotation.id === selectedIdRef.current);
      if (selected) {
        if (!selected.points || selected.points.length === 4) {
          const corner = hitCorner(pos, selected, imgSizeRef.current, transform());
          if (corner === 0 || corner === 3) return "nwse-resize";
          if (corner === 1 || corner === 2) return "nesw-resize";
        } else if (hitVertex(pos, selected, imgSizeRef.current, transform()) !== -1) {
          return "crosshair";
        }
        if (hitAnnotation(pos, selected, imgSizeRef.current, transform())) return "move";
      }
      for (let index = annotations.length - 1; index >= 0; index--) {
        if (hitAnnotation(pos, annotations[index], imgSizeRef.current, transform())) return "pointer";
      }
      return "grab";
    }

    function updateCursor(pos?: Point) {
      const tool = toolRef.current;
      if (tool === "box" || tool === "polygon") {
        canvasElement.style.cursor = "crosshair";
        return;
      }
      if (tool === "hand") {
        canvasElement.style.cursor = pos ? getHandCursor(pos) : "grab";
        return;
      }
      canvasElement.style.cursor = "default";
    }

    function onMouseDown(event: MouseEvent) {
      const pos = canvasPos(event);

      if (event.button === 1 || spaceDownRef.current) {
        dragModeRef.current = "pan";
        dragStartPosRef.current = pos;
        canvasElement.style.cursor = "grabbing";
        return;
      }

      if (toolRef.current === "hand") {
        const annotations = annotationsRef.current;
        const selected = annotations.find(annotation => annotation.id === selectedIdRef.current);

        if (selected && (!selected.points || selected.points.length === 4)) {
          const corner = hitCorner(pos, selected, imgSizeRef.current, transform());
          if (corner !== -1) {
            dragModeRef.current = "resize";
            dragStartPosRef.current = pos;
            dragAnnIdRef.current = selected.id;
            dragAnnOrigRef.current = { ...selected };
            resizeCornerRef.current = corner;
            canvasElement.style.cursor = (corner === 0 || corner === 3) ? "nwse-resize" : "nesw-resize";
            return;
          }
        }

        if (selected && selected.points && selected.points.length > 4) {
          const vertexIndex = hitVertex(pos, selected, imgSizeRef.current, transform());
          if (vertexIndex !== -1) {
            dragModeRef.current = "vertex";
            dragStartPosRef.current = pos;
            dragAnnIdRef.current = selected.id;
            dragAnnOrigRef.current = { ...selected };
            dragVertexIndexRef.current = vertexIndex;
            canvasElement.style.cursor = "crosshair";
            return;
          }
        }

        for (let index = annotations.length - 1; index >= 0; index--) {
          if (hitAnnotation(pos, annotations[index], imgSizeRef.current, transform())) {
            onSelectRef.current(annotations[index].id);
            dragModeRef.current = "move";
            dragStartPosRef.current = pos;
            dragAnnIdRef.current = annotations[index].id;
            dragAnnOrigRef.current = { ...annotations[index] };
            canvasElement.style.cursor = "move";
            return;
          }
        }

        onSelectRef.current(null);
        dragModeRef.current = "pan";
        dragStartPosRef.current = pos;
        canvasElement.style.cursor = "grabbing";
        return;
      }

      if (toolRef.current === "box") {
        const clamped = clampToImage(pos);
        isDrawingRef.current = true;
        drawStartRef.current = clamped;
        drawEndRef.current = clamped;
        return;
      }

      if (toolRef.current === "polygon") {
        const clamped = clampToImage(pos);
        const points = polygonPointsRef.current;
        const { w: imageWidth, h: imageHeight } = imgSizeRef.current;

        if (points.length >= 3) {
          const firstCanvas = {
            x: points[0].x * imageWidth * scaleRef.current + offsetRef.current.x,
            y: points[0].y * imageHeight * scaleRef.current + offsetRef.current.y,
          };
          const dx = clamped.x - firstCanvas.x;
          const dy = clamped.y - firstCanvas.y;
          if (Math.sqrt(dx * dx + dy * dy) <= POLYGON_CLOSE_RADIUS) {
            finishPolygon();
            return;
          }
        }

        const imagePos = canvasToImage(clamped.x, clamped.y);
        const nextPoint = { x: clampPt(imagePos.x / imageWidth), y: clampPt(imagePos.y / imageHeight) };
        polygonPointsRef.current = [...points, nextPoint];
        redraw();
      }
    }

    function onMouseMove(event: MouseEvent) {
      const pos = canvasPos(event);
      const imagePos = canvasToImage(pos.x, pos.y);
      onCoordsChangeRef.current(Math.round(imagePos.x), Math.round(imagePos.y));

      if (dragModeRef.current === "pan") {
        const dx = pos.x - dragStartPosRef.current.x;
        const dy = pos.y - dragStartPosRef.current.y;
        offsetRef.current = { x: offsetRef.current.x + dx, y: offsetRef.current.y + dy };
        dragStartPosRef.current = pos;
        redraw();
        return;
      }

      if (dragModeRef.current === "move") {
        const original = dragAnnOrigRef.current!;
        const startImage = canvasToImage(dragStartPosRef.current.x, dragStartPosRef.current.y);
        const currentImage = canvasToImage(pos.x, pos.y);
        const dx = (currentImage.x - startImage.x) / imgSizeRef.current.w;
        const dy = (currentImage.y - startImage.y) / imgSizeRef.current.h;

        if (original.points && original.points.length >= 3) {
          const newPoints = original.points.map(point => ({ x: clampPt(point.x + dx), y: clampPt(point.y + dy) }));
          previewAnnRef.current = { ...original, ...pointsToBbox(newPoints), points: newPoints };
        } else {
          previewAnnRef.current = { ...original, ...clampBBox(original.cx + dx, original.cy + dy, original.w, original.h) };
        }
        redraw();
        return;
      }

      if (dragModeRef.current === "vertex") {
        const original = dragAnnOrigRef.current!;
        const currentImage = canvasToImage(pos.x, pos.y);
        const vertexIndex = dragVertexIndexRef.current;
        const newPoints = original.points!.map((point, index) =>
          index === vertexIndex ? { x: clampPt(currentImage.x / imgSizeRef.current.w), y: clampPt(currentImage.y / imgSizeRef.current.h) } : point,
        );
        previewAnnRef.current = { ...original, ...pointsToBbox(newPoints), points: newPoints };
        redraw();
        return;
      }

      if (dragModeRef.current === "resize") {
        const original = dragAnnOrigRef.current!;
        const currentImage = canvasToImage(pos.x, pos.y);
        const corner = resizeCornerRef.current;

        let left = (original.cx - original.w / 2) * imgSizeRef.current.w;
        let right = (original.cx + original.w / 2) * imgSizeRef.current.w;
        let top = (original.cy - original.h / 2) * imgSizeRef.current.h;
        let bottom = (original.cy + original.h / 2) * imgSizeRef.current.h;

        if (corner === 0) { left = currentImage.x; top = currentImage.y; }
        if (corner === 1) { right = currentImage.x; top = currentImage.y; }
        if (corner === 2) { left = currentImage.x; bottom = currentImage.y; }
        if (corner === 3) { right = currentImage.x; bottom = currentImage.y; }

        if (right - left < MIN_BOX_PX) {
          if (corner === 0 || corner === 2) left = right - MIN_BOX_PX;
          else right = left + MIN_BOX_PX;
        }
        if (bottom - top < MIN_BOX_PX) {
          if (corner === 0 || corner === 1) top = bottom - MIN_BOX_PX;
          else bottom = top + MIN_BOX_PX;
        }

        previewAnnRef.current = {
          ...original,
          ...clampBBox(
            (left + right) / 2 / imgSizeRef.current.w,
            (top + bottom) / 2 / imgSizeRef.current.h,
            (right - left) / imgSizeRef.current.w,
            (bottom - top) / imgSizeRef.current.h,
          ),
        };
        redraw();
        return;
      }

      if (isDrawingRef.current) {
        drawEndRef.current = clampToImage(pos);
        redraw();
        return;
      }

      if (toolRef.current === "polygon") {
        polygonMouseRef.current = clampToImage(pos);
        if (polygonPointsRef.current.length > 0) {
          redraw();
          return;
        }
      }

      if (toolRef.current === "hand") updateCursor(pos);
    }

    function onMouseUp(event: MouseEvent) {
      if (dragModeRef.current === "move" || dragModeRef.current === "resize" || dragModeRef.current === "vertex") {
        const preview = previewAnnRef.current;
        if (preview) {
          onAnnotationsChangeRef.current(
            annotationsRef.current.map(annotation => annotation.id === preview.id ? preview : annotation),
          );
          previewAnnRef.current = null;
        }
        dragModeRef.current = "none";
        dragAnnIdRef.current = null;
        dragAnnOrigRef.current = null;
        updateCursor(canvasPos(event));
        return;
      }

      if (dragModeRef.current === "pan") {
        dragModeRef.current = "none";
        updateCursor(canvasPos(event));
        return;
      }

      if (isDrawingRef.current && toolRef.current === "box") {
        isDrawingRef.current = false;
        const start = drawStartRef.current;
        const end = clampToImage(canvasPos(event));
        if (Math.abs(end.x - start.x) > 8 && Math.abs(end.y - start.y) > 8) {
          const startImage = canvasToImage(start.x, start.y);
          const endImage = canvasToImage(end.x, end.y);
          const yolo = imageToYolo(
            Math.min(startImage.x, endImage.x),
            Math.min(startImage.y, endImage.y),
            Math.abs(endImage.x - startImage.x),
            Math.abs(endImage.y - startImage.y),
          );
          const newAnnotation: BBox = {
            id: crypto.randomUUID(),
            classIndex: activeClassIndexRef.current,
            ...clampBBox(yolo.cx, yolo.cy, yolo.w, yolo.h),
          };
          onAnnotationsChangeRef.current([...annotationsRef.current, newAnnotation]);
          onSelectRef.current(newAnnotation.id);
        }
        redraw();
      }
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const pos = canvasPos(event);
      applyZoomAtPoint(event.deltaY < 0 ? ZOOM_WHEEL_IN : 1 / ZOOM_WHEEL_IN, pos.x, pos.y);
    }

    updateCursor();
    canvasElement.addEventListener("mousedown", onMouseDown);
    canvasElement.addEventListener("mousemove", onMouseMove);
    canvasElement.addEventListener("mouseup", onMouseUp);
    canvasElement.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvasElement.removeEventListener("mousedown", onMouseDown);
      canvasElement.removeEventListener("mousemove", onMouseMove);
      canvasElement.removeEventListener("mouseup", onMouseUp);
      canvasElement.removeEventListener("wheel", onWheel);
    };
  }, [activeClassIndexRef, annotationsRef, applyZoomAtPoint, canvasPos, canvasRef, canvasToImage, clampToImage, dragAnnIdRef, dragAnnOrigRef, dragModeRef, dragStartPosRef, dragVertexIndexRef, drawEndRef, drawStartRef, imageToYolo, imgSizeRef, isDrawingRef, offsetRef, onAnnotationsChangeRef, onCoordsChangeRef, onSelectRef, polygonMouseRef, polygonPointsRef, previewAnnRef, redraw, resizeCornerRef, scaleRef, selectedIdRef, spaceDownRef, toolRef]);
}
