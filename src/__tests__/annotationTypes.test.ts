import { describe, it, expect } from "vitest";
import { clampBBox, clampPt, bboxToPoints, pointsToBbox } from "../mainview/lib/annotationTypes";

describe("clampPt", () => {
	it("clamps to 0 when below", () => expect(clampPt(-0.5)).toBe(0));
	it("clamps to 1 when above", () => expect(clampPt(1.5)).toBe(1));
	it("returns same when in range", () => expect(clampPt(0.5)).toBe(0.5));
});

describe("clampBBox", () => {
	it("clamps all edges within [0,1]", () => {
		const result = clampBBox(0.9, 0.9, 0.5, 0.5);
		expect(result.cx).toBeLessThanOrEqual(1);
		expect(result.cy).toBeLessThanOrEqual(1);
		expect(result.w).toBeLessThanOrEqual(1);
		expect(result.h).toBeLessThanOrEqual(1);
	});
	it("preserves center when no clamping needed", () => {
		const result = clampBBox(0.5, 0.5, 0.2, 0.2);
		expect(result.cx).toBe(0.5);
		expect(result.cy).toBe(0.5);
	});
});

describe("bboxToPoints", () => {
	it("converts to 4 corners", () => {
		const pts = bboxToPoints(0.5, 0.5, 0.4, 0.4);
		expect(pts).toHaveLength(4);
	});
});

describe("pointsToBbox", () => {
	it("derives bbox from points", () => {
		const pts = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }];
		const bbox = pointsToBbox(pts);
		expect(bbox.cx).toBeCloseTo(0.5);
		expect(bbox.cy).toBeCloseTo(0.5);
		expect(bbox.w).toBeCloseTo(0.8);
		expect(bbox.h).toBeCloseTo(0.8);
	});
});