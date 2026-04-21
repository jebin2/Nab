import { describe, it, expect } from "vitest";
import { getPeakUsage } from "../mainview/components/useRunDetailState";

describe("getPeakUsage", () => {
  it("returns peak RAM usage across multiple epochs", () => {
    const lines = [
      JSON.stringify({ type: "progress", epoch: 1, ramMB: 512 }),
      JSON.stringify({ type: "progress", epoch: 2, ramMB: 768 }),
      JSON.stringify({ type: "progress", epoch: 3, ramMB: 640 }),
    ];
    expect(getPeakUsage(lines, "ramMB")).toBe(768);
  });

  it("returns peak GPU memory", () => {
    const lines = [
      JSON.stringify({ type: "progress", epoch: 1, gpuMB: 1024 }),
      JSON.stringify({ type: "progress", epoch: 2, gpuMB: 2048 }),
    ];
    expect(getPeakUsage(lines, "gpuMB")).toBe(2048);
  });

  it("returns null when no progress events", () => {
    const lines = [JSON.stringify({ type: "done", mAP50: 0.9 })];
    expect(getPeakUsage(lines, "ramMB")).toBeNull();
  });

  it("returns null when metric not present in any event", () => {
    const lines = [JSON.stringify({ type: "progress", epoch: 1 })];
    expect(getPeakUsage(lines, "ramMB")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(getPeakUsage([], "ramMB")).toBeNull();
  });

  it("ignores non-progress events mixed in", () => {
    const lines = [
      JSON.stringify({ type: "stderr", text: "some output" }),
      JSON.stringify({ type: "progress", epoch: 1, ramMB: 400 }),
      JSON.stringify({ type: "done", mAP50: 0.9 }),
    ];
    expect(getPeakUsage(lines, "ramMB")).toBe(400);
  });

  it("ignores malformed lines", () => {
    const lines = [
      "not json",
      JSON.stringify({ type: "progress", epoch: 1, ramMB: 300 }),
    ];
    expect(getPeakUsage(lines, "ramMB")).toBe(300);
  });
});
