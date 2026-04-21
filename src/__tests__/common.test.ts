import { describe, it, expect } from "vitest";
import { join } from "path";
import { homedir } from "os";
import { exp } from "../bun/common";

describe("exp", () => {
	it("expands tilde to home directory", () => {
		const result = exp("~/foo/bar");
		expect(result).toBe(join(homedir(), "foo/bar"));
	});

	it("returns unchanged path when no tilde", () => {
		const result = exp("/absolute/path");
		expect(result).toBe("/absolute/path");
	});

	it("handles tilde at end", () => {
		const result = exp("~/");
		expect(result).toBe(homedir() + "/");
	});
});
