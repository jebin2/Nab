import { describe, it, expect } from "vitest";
import { parsePushLog } from "../mainview/lib/pushLog";

describe("parsePushLog", () => {
	it("returns pushing by default", () => {
		const lines = [JSON.stringify({ type: "progress", text: "working" })];
		const result = parsePushLog(lines);
		expect(result.phase).toBe("pushing");
	});

	it("detects done with url", () => {
		const lines = [JSON.stringify({ type: "done", url: "https://huggingface.co/models/test" })];
		const result = parsePushLog(lines);
		expect(result.phase).toBe("done");
		expect(result.url).toBe("https://huggingface.co/models/test");
	});

	it("detects error", () => {
		const lines = [JSON.stringify({ type: "error", message: "Upload failed" })];
		const result = parsePushLog(lines);
		expect(result.phase).toBe("error");
	});

	it("ignores non-JSON lines", () => {
		const lines = ["some debug output", JSON.stringify({ type: "done", url: "http://x.io" })];
		const result = parsePushLog(lines);
		expect(result.phase).toBe("done");
	});

	it("ignores invalid JSON", () => {
		const lines = ["{not json", JSON.stringify({ type: "done", url: "http://x.io" })];
		const result = parsePushLog(lines);
		expect(result.phase).toBe("done");
	});
});