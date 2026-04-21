import { describe, it, expect } from "vitest";
import { parseLogLine, type LogEvent } from "../mainview/lib/logParser";

function narrow<T extends LogEvent["type"]>(
  result: LogEvent | null,
  type: T,
): Extract<LogEvent, { type: T }> {
  expect(result).not.toBeNull();
  expect(result!.type).toBe(type);
  return result as Extract<LogEvent, { type: T }>;
}

describe("parseLogLine", () => {
  it("parses progress event with training metrics", () => {
    const ev = narrow(
      parseLogLine(JSON.stringify({ type: "progress", epoch: 5, epochs: 100, loss: 0.432 })),
      "progress",
    );
    expect(ev.epoch).toBe(5);
    expect(ev.epochs).toBe(100);
    expect(ev.loss).toBe(0.432);
  });

  it("parses done event with mAP fields", () => {
    const ev = narrow(
      parseLogLine(JSON.stringify({ type: "done", mAP50: 0.912, mAP50_95: 0.741 })),
      "done",
    );
    expect(ev.mAP50).toBe(0.912);
    expect(ev.mAP50_95).toBe(0.741);
  });

  it("parses error event", () => {
    const ev = narrow(
      parseLogLine(JSON.stringify({ type: "error", message: "Training failed" })),
      "error",
    );
    expect(ev.message).toBe("Training failed");
  });

  it("parses stderr event", () => {
    const ev = narrow(
      parseLogLine(JSON.stringify({ type: "stderr", text: "some output" })),
      "stderr",
    );
    expect(ev.text).toBe("some output");
  });

  it("parses dataset event", () => {
    const ev = narrow(
      parseLogLine(JSON.stringify({ type: "dataset", imageCount: 150 })),
      "dataset",
    );
    expect(ev.imageCount).toBe(150);
  });

  it("parses dataset_copy_start event", () => {
    const ev = narrow(
      parseLogLine(JSON.stringify({ type: "dataset_copy_start", total: 200 })),
      "dataset_copy_start",
    );
    expect(ev.total).toBe(200);
  });

  it("parses dataset_copy_progress event", () => {
    const ev = narrow(
      parseLogLine(JSON.stringify({ type: "dataset_copy_progress", done: 50, total: 200 })),
      "dataset_copy_progress",
    );
    expect(ev.done).toBe(50);
    expect(ev.total).toBe(200);
  });

  it("parses start event with timestamp", () => {
    const ev = narrow(
      parseLogLine(JSON.stringify({ type: "start", timestamp: "2024-01-01T00:00:00Z" })),
      "start",
    );
    expect(ev.timestamp).toBe("2024-01-01T00:00:00Z");
  });

  it("returns null for plain text", () => {
    expect(parseLogLine("just some text")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseLogLine("{not valid json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseLogLine("")).toBeNull();
  });

  it("returns null for missing type field", () => {
    expect(parseLogLine(JSON.stringify({ epoch: 5 }))).toBeNull();
  });

  it("returns null for non-string type", () => {
    expect(parseLogLine(JSON.stringify({ type: 123 }))).toBeNull();
  });

  it("returns null for JSON array", () => {
    expect(parseLogLine(JSON.stringify([1, 2, 3]))).toBeNull();
  });
});
