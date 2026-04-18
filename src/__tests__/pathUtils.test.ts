import { describe, it, expect } from "vitest";
import { sortPathsNumerically } from "../bun/pathUtils";

describe("sortPathsNumerically", () => {
	it("sorts with numeric awareness", () => {
		const paths = ["img10.jpg", "img2.jpg", "img1.jpg", "img20.jpg"];
		const sorted = sortPathsNumerically(paths);
		expect(sorted).toEqual(["img1.jpg", "img2.jpg", "img10.jpg", "img20.jpg"]);
	});
	it("handles mixed extensions", () => {
		const paths = ["a2.txt", "a10.txt", "a1.txt"];
		const sorted = sortPathsNumerically(paths);
		expect(sorted).toEqual(["a1.txt", "a2.txt", "a10.txt"]);
	});
});