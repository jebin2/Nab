import { describe, it, expect } from "vitest";
import { applyLogLine, parseLog, EMPTY_SUMMARY } from "../mainview/lib/trainLog";
import { formatUpdated } from "../mainview/lib/formatTime";
import { dedupeTail } from "../mainview/components/useRunDetailState";

const progress = (epoch: number) => JSON.stringify({ type: "progress", epoch, epochs: 10, loss: 1 / epoch });

describe("applyLogLine", () => {
  it("gives the same result line by line as parsing the whole log", () => {
    const lines = [JSON.stringify({ type: "start", timestamp: "t" }), progress(1), "plain text", progress(2),
      JSON.stringify({ type: "done", mAP50: 0.8, mAP50_95: 0.5, weightsPath: "w" })];
    let s = EMPTY_SUMMARY;
    for (const l of lines) s = applyLogLine(s, l);
    expect(s).toEqual(parseLog(lines));
    expect(s.progress?.epoch).toBe(2);
    expect(s.done?.mAP50).toBe(0.8);
  });

  it("returns the same object for lines that change nothing", () => {
    expect(applyLogLine(EMPTY_SUMMARY, "not json")).toBe(EMPTY_SUMMARY);
    expect(applyLogLine(EMPTY_SUMMARY, JSON.stringify({ type: "stderr", text: "x" }))).toBe(EMPTY_SUMMARY);
  });

  it("a new start clears a previous session's done/error", () => {
    const s = parseLog([JSON.stringify({ type: "error", message: "boom" }), JSON.stringify({ type: "start", timestamp: "t" })]);
    expect(s.error).toBeUndefined();
  });
});

describe("formatUpdated", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  it("formats timestamps relative to now", () => {
    expect(formatUpdated("2026-11-14T11:59:30Z", now)).toBe("just now");
    expect(formatUpdated("2026-11-14T11:55:00Z", now)).toBe("5 min ago");
    expect(formatUpdated("2026-11-14T09:00:00Z", now)).toBe("3 h ago");
    expect(formatUpdated("2026-11-12T12:00:00Z", now)).toBe("2 d ago");
  });
  it("shows old free-text values unchanged", () => {
    expect(formatUpdated("just now", now)).toBe("just now");
  });
});

describe("dedupeTail", () => {
  it("drops pushed lines already in the file", () => {
    expect(dedupeTail(["a", "b", "c"], ["b", "c", "d"])).toEqual(["a", "b", "c", "d"]);
  });
  it("appends pushed lines that are all new", () => {
    expect(dedupeTail(["a"], ["b"])).toEqual(["a", "b"]);
  });
  it("keeps the file when nothing was pushed", () => {
    expect(dedupeTail(["a"], [])).toEqual(["a"]);
  });
});
