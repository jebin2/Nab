import { type BBox } from "../lib/annotationTypes";

export const HANDLE_RADIUS = 6;
export const MIN_BOX_PX = 10;
export const CANVAS_BG = "#111111";
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 10;
export const ZOOM_WHEEL_IN = 1.1;
export const ZOOM_BTN = 1.25;
export const POLYGON_CLOSE_RADIUS = 12;

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type ImageSize = { w: number; h: number };
export type CanvasTransform = { scale: number; offset: Point };

export function drawBox(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  color: string,
  label: string,
  isSelected: boolean,
) {
  const { x, y, w, h } = rect;

  ctx.fillStyle = color + "18";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 2 : 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(x, y, w, h);

  ctx.font = "bold 11px Inter, system-ui, sans-serif";
  const pillW = ctx.measureText(label).width + 12;
  const pillH = 18;
  const px = x;
  const py = y - pillH - 2 < 0 ? y + 2 : y - pillH - 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(px, py, pillW, pillH, 3);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(label, px + 6, py + 12);

  if (isSelected) {
    const corners = [
      { x, y },
      { x: x + w, y },
      { x, y: y + h },
      { x: x + w, y: y + h },
    ];
    for (const corner of corners) {
      ctx.beginPath();
      ctx.arc(corner.x, corner.y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

export function drawPolygon(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  label: string,
  isSelected: boolean,
) {
  if (points.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index++) ctx.lineTo(points[index].x, points[index].y);
  ctx.closePath();
  ctx.fillStyle = color + "18";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 2 : 1.5;
  ctx.setLineDash([]);
  ctx.stroke();

  const minX = Math.min(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y));
  ctx.font = "bold 11px Inter, system-ui, sans-serif";
  const pillW = ctx.measureText(label).width + 12;
  const pillH = 18;
  const px = minX;
  const py = minY - pillH - 2 < 0 ? minY + 2 : minY - pillH - 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(px, py, pillW, pillH, 3);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(label, px + 6, py + 12);

  if (isSelected) {
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

export function pointInPolygon(pos: Point, points: Point[]): boolean {
  let inside = false;
  for (let index = 0, prev = points.length - 1; index < points.length; prev = index++) {
    const xi = points[index].x;
    const yi = points[index].y;
    const xj = points[prev].x;
    const yj = points[prev].y;
    if ((yi > pos.y) !== (yj > pos.y) &&
        pos.x < ((xj - xi) * (pos.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function annotationToCanvasPoints(
  annotation: BBox,
  imageSize: ImageSize,
  transform: CanvasTransform,
): Point[] | null {
  if (!annotation.points || annotation.points.length < 3) return null;
  const { scale, offset } = transform;
  return annotation.points.map(point => ({
    x: point.x * imageSize.w * scale + offset.x,
    y: point.y * imageSize.h * scale + offset.y,
  }));
}

export function canvasToImagePoint(point: Point, transform: CanvasTransform): Point {
  return {
    x: (point.x - transform.offset.x) / transform.scale,
    y: (point.y - transform.offset.y) / transform.scale,
  };
}

export function imageToCanvasRect(
  box: Pick<BBox, "cx" | "cy" | "w" | "h">,
  imageSize: ImageSize,
  transform: CanvasTransform,
): Rect {
  const { scale, offset } = transform;
  return {
    x: (box.cx - box.w / 2) * imageSize.w * scale + offset.x,
    y: (box.cy - box.h / 2) * imageSize.h * scale + offset.y,
    w: box.w * imageSize.w * scale,
    h: box.h * imageSize.h * scale,
  };
}

export function clampCanvasPointToImage(point: Point, imageSize: ImageSize, transform: CanvasTransform): Point {
  const maxX = transform.offset.x + imageSize.w * transform.scale;
  const maxY = transform.offset.y + imageSize.h * transform.scale;
  return {
    x: Math.max(transform.offset.x, Math.min(maxX, point.x)),
    y: Math.max(transform.offset.y, Math.min(maxY, point.y)),
  };
}

export function hitBox(pos: Point, annotation: BBox, imageSize: ImageSize, transform: CanvasTransform): boolean {
  const rect = imageToCanvasRect(annotation, imageSize, transform);
  return pos.x >= rect.x && pos.x <= rect.x + rect.w && pos.y >= rect.y && pos.y <= rect.y + rect.h;
}

export function hitCorner(pos: Point, annotation: BBox, imageSize: ImageSize, transform: CanvasTransform): number {
  const rect = imageToCanvasRect(annotation, imageSize, transform);
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x, y: rect.y + rect.h },
    { x: rect.x + rect.w, y: rect.y + rect.h },
  ];
  for (let index = 0; index < corners.length; index++) {
    const dx = pos.x - corners[index].x;
    const dy = pos.y - corners[index].y;
    if (Math.sqrt(dx * dx + dy * dy) <= HANDLE_RADIUS + 2) return index;
  }
  return -1;
}

export function hitVertex(pos: Point, annotation: BBox, imageSize: ImageSize, transform: CanvasTransform): number {
  const points = annotationToCanvasPoints(annotation, imageSize, transform);
  if (!points) return -1;
  for (let index = 0; index < points.length; index++) {
    const dx = pos.x - points[index].x;
    const dy = pos.y - points[index].y;
    if (Math.sqrt(dx * dx + dy * dy) <= HANDLE_RADIUS + 2) return index;
  }
  return -1;
}

export function hitAnnotation(pos: Point, annotation: BBox, imageSize: ImageSize, transform: CanvasTransform): boolean {
  const points = annotationToCanvasPoints(annotation, imageSize, transform);
  return points ? pointInPolygon(pos, points) : hitBox(pos, annotation, imageSize, transform);
}
