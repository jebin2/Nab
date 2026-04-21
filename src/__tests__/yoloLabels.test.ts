import { describe, it, expect } from "vitest";
import { parseYoloLabels, serializeYoloLabels } from "../bun/yoloLabels";

describe("parseYoloLabels", () => {
	it("parses bounding box line", () => {
		const text = "0 0.5 0.5 0.2 0.2";
		const result = parseYoloLabels(text);
		expect(result).toHaveLength(1);
		expect(result[0].classIndex).toBe(0);
		expect(result[0].cx).toBe(0.5);
		expect(result[0].cy).toBe(0.5);
		expect(result[0].w).toBe(0.2);
		expect(result[0].h).toBe(0.2);
	});

	it("parses multiple lines", () => {
		const text = "0 0.5 0.5 0.2 0.2\n1 0.3 0.3 0.1 0.1";
		const result = parseYoloLabels(text);
		expect(result).toHaveLength(2);
		expect(result[0].classIndex).toBe(0);
		expect(result[1].classIndex).toBe(1);
	});

	it("parses segmentation with more than 4 points as polygon", () => {
		const text = "0 0.0 0.0 0.5 0.0 0.5 0.5 0.0 0.5 0.25 0.75";
		const result = parseYoloLabels(text);
		expect(result).toHaveLength(1);
		expect(result[0].points).toBeDefined();
		expect(result[0].points!.length).toBe(5);
	});

	it("parses 4-corner rect as bbox (not polygon)", () => {
		const text = "0 0.0 0.0 1.0 0.0 1.0 1.0 0.0 1.0";
		const result = parseYoloLabels(text);
		expect(result).toHaveLength(1);
		expect(result[0].points).toBeUndefined();
	});

	it("handles empty text", () => {
		expect(parseYoloLabels("")).toEqual([]);
	});

	it("skips empty lines", () => {
		const text = "0 0.5 0.5 0.2 0.2\n\n1 0.3 0.3 0.1 0.1";
		const result = parseYoloLabels(text);
		expect(result).toHaveLength(2);
	});
});

describe("serializeYoloLabels", () => {
	it("serializes bounding box as 4-corner polygon", () => {
		const anns = [{ classIndex: 0, cx: 0.5, cy: 0.5, w: 0.2, h: 0.2 }];
		const result = serializeYoloLabels(anns);
		expect(result).toContain("0");
		expect(result).toContain("0.400000");
		expect(result).toContain("0.600000");
	});

	it("serializes with custom polygon points", () => {
		const anns = [{
			classIndex: 1,
			cx: 0.5, cy: 0.5, w: 0.2, h: 0.2,
			points: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 0.6 }, { x: 0.4, y: 0.6 }, { x: 0.5, y: 0.8 }]
		}];
		const result = serializeYoloLabels(anns);
		expect(result).toContain("1");
		expect(result).toContain("0.400000");
		expect(result).toContain("0.800000");
	});

	it("handles empty array", () => {
		expect(serializeYoloLabels([])).toBe("");
	});
});
