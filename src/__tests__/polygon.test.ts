import { describe, it, expect } from "vitest";
import { isAxisAlignedRect, isTruePolygon, parseSegmentationLine, type Point } from "../bun/polygon";

describe("parseSegmentationLine", () => {
	it("parses valid segmentation line", () => {
		const result = parseSegmentationLine("0 0.0 0.0 1.0 0.0 1.0 1.0 0.0 1.0");
		expect(result).not.toBeNull();
		expect(result).toHaveLength(4);
		expect(result![0].x).toBe(0);
		expect(result![0].y).toBe(0);
	});

	it("returns null for bbox format (5 tokens)", () => {
		const result = parseSegmentationLine("0 0.5 0.5 0.2 0.2");
		expect(result).toBeNull();
	});

	it("returns null for invalid odd token count", () => {
		const result = parseSegmentationLine("0 0.0 0.0 1.0 0.0 1.0");
		expect(result).toBeNull();
	});

	it("returns null for empty line", () => {
		const result = parseSegmentationLine("");
		expect(result).toBeNull();
	});
});

describe("isAxisAlignedRect", () => {
	it("returns true for 4-corner axis-aligned rect", () => {
		const pts: Point[] = [
			{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }
		];
		expect(isAxisAlignedRect(pts)).toBe(true);
	});

	it("returns false for polygon with 5+ points", () => {
		const pts: Point[] = [
			{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }
		];
		expect(isAxisAlignedRect(pts)).toBe(false);
	});

	it("returns false for tilted rectangle", () => {
		const pts: Point[] = [
			{ x: 0, y: 0 }, { x: 0.8, y: 0.2 }, { x: 1, y: 1 }, { x: 0.2, y: 0.8 }
		];
		expect(isAxisAlignedRect(pts)).toBe(false);
	});

	it("returns false for empty array", () => {
		expect(isAxisAlignedRect([])).toBe(false);
	});
});

describe("isTruePolygon", () => {
	it("returns true for 5+ points", () => {
		const pts: Point[] = [
			{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }
		];
		expect(isTruePolygon(pts)).toBe(true);
	});

	it("returns false for 4-corner axis-aligned rect", () => {
		const pts: Point[] = [
			{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }
		];
		expect(isTruePolygon(pts)).toBe(false);
	});

	it("returns true for tilted rectangle (4 points)", () => {
		const pts: Point[] = [
			{ x: 0, y: 0 }, { x: 0.8, y: 0.2 }, { x: 1, y: 1 }, { x: 0.2, y: 0.8 }
		];
		expect(isTruePolygon(pts)).toBe(true);
	});
});
