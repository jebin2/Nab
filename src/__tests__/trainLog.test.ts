import { describe, it, expect } from "vitest";
import { parseLog } from "../mainview/lib/trainLog";

describe("parseLog", () => {
  it("extracts progress event", () => {
    const lines = [JSON.stringify({ type: "progress", epoch: 5, epochs: 100, loss: 0.432, mAP: 0.65 })];
    const result = parseLog(lines);
    expect(result.progress?.epoch).toBe(5);
    expect(result.progress?.epochs).toBe(100);
  });

  it("returns the last progress when multiple are present", () => {
    const lines = [
      JSON.stringify({ type: "progress", epoch: 1, epochs: 10 }),
      JSON.stringify({ type: "progress", epoch: 2, epochs: 10 }),
      JSON.stringify({ type: "progress", epoch: 3, epochs: 10 }),
    ];
    expect(parseLog(lines).progress?.epoch).toBe(3);
  });

  it("extracts done event", () => {
    const lines = [JSON.stringify({ type: "done", mAP50: 0.912, mAP50_95: 0.741, weightsPath: "/path/to/best.pt" })];
    const result = parseLog(lines);
    expect(result.done?.mAP50).toBe(0.912);
    expect(result.done?.weightsPath).toBe("/path/to/best.pt");
  });

  it("defaults missing done fields to zero / empty string", () => {
    const lines = [JSON.stringify({ type: "done" })];
    const result = parseLog(lines);
    expect(result.done?.mAP50).toBe(0);
    expect(result.done?.mAP50_95).toBe(0);
    expect(result.done?.weightsPath).toBe("");
  });

  it("extracts error event", () => {
    const lines = [JSON.stringify({ type: "error", message: "Training failed" })];
    expect(parseLog(lines).error?.message).toBe("Training failed");
  });

  it("extracts dataset size", () => {
    const lines = [JSON.stringify({ type: "dataset", imageCount: 150 })];
    expect(parseLog(lines).datasetSize).toBe(150);
  });

  it("extracts copy progress — start then update", () => {
    const lines = [
      JSON.stringify({ type: "dataset_copy_start", total: 100 }),
      JSON.stringify({ type: "dataset_copy_progress", done: 50, total: 100 }),
    ];
    const result = parseLog(lines);
    expect(result.copyProgress?.done).toBe(50);
    expect(result.copyProgress?.total).toBe(100);
  });

  it("initialises copy progress done to 0 on start event", () => {
    const lines = [JSON.stringify({ type: "dataset_copy_start", total: 80 })];
    const result = parseLog(lines);
    expect(result.copyProgress?.done).toBe(0);
    expect(result.copyProgress?.total).toBe(80);
  });

  it("detects early stop", () => {
    const lines = [JSON.stringify({ type: "progress", epoch: 10, epochs: 100, earlyStop: true })];
    expect(parseLog(lines).earlyStopTriggered).toBe(true);
  });

  it("does not flag early stop when earlyStop is false", () => {
    const lines = [JSON.stringify({ type: "progress", epoch: 1, epochs: 10, earlyStop: false })];
    expect(parseLog(lines).earlyStopTriggered).toBe(false);
  });

  it("silently ignores start event", () => {
    const lines = [
      JSON.stringify({ type: "start", timestamp: "2024-01-01T00:00:00Z" }),
      JSON.stringify({ type: "progress", epoch: 1, epochs: 10 }),
    ];
    const result = parseLog(lines);
    expect(result.progress?.epoch).toBe(1);
  });

  it("handles mixed valid and invalid lines", () => {
    const lines = ["", "not json", JSON.stringify({ type: "progress", epoch: 1, epochs: 10 })];
    expect(parseLog(lines).progress?.epoch).toBe(1);
  });

  it("returns all undefined for empty input", () => {
    const result = parseLog([]);
    expect(result.progress).toBeUndefined();
    expect(result.done).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.datasetSize).toBeUndefined();
    expect(result.copyProgress).toBeUndefined();
    expect(result.earlyStopTriggered).toBe(false);
  });
});
