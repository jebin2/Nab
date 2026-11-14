import { describe, it, expect } from "vitest";
import { planFor, ProgressTracker } from "../main/engine";

describe("planFor", () => {
  const nvidia = (driverMajor: number) => ({ kind: "nvidia" as const, name: "NVIDIA GeForce RTX 4070", driverMajor });

  it("picks the CUDA build that matches the NVIDIA driver", () => {
    expect(planFor("linux-x64", nvidia(580)).variant).toBe("cu130");
    expect(planFor("linux-x64", nvidia(550)).variant).toBe("cu126");
    expect(planFor("win32-x64", nvidia(591)).variant).toBe("cu130");
    expect(planFor("win32-x64", nvidia(536)).variant).toBe("cu126");
  });

  it("uses the small CPU build without an NVIDIA GPU", () => {
    const linux = planFor("linux-x64", { kind: "none" });
    expect(linux.variant).toBe("cpu");
    expect(linux.downloadMB).toBeLessThan(500);
    expect(planFor("win32-x64", { kind: "none" }).variant).toBe("cpu");
  });

  it("uses PyPI's build on Apple Silicon", () => {
    const mac = planFor("darwin-arm64", { kind: "apple", name: "Apple Silicon GPU" });
    expect(mac.variant).toBe("pypi");
    expect(mac.gpuSummary).toMatch(/Apple Silicon/);
  });

  it("always states a download size for supported desktop platforms", () => {
    for (const [p, gpu] of [["linux-x64", nvidia(580)], ["linux-x64", nvidia(500)], ["win32-x64", nvidia(580)],
      ["win32-x64", { kind: "none" }], ["darwin-arm64", { kind: "apple" }]] as const) {
      expect(planFor(p, gpu).downloadMB, p).toBeGreaterThan(0);
    }
  });

  it("explains in plain words when training can't run", () => {
    const intel = planFor("darwin-x64", { kind: "none" });
    expect(intel.unsupported).toMatch(/Apple Silicon/);
    expect(planFor("freebsd-x64", { kind: "none" }).unsupported).toBeTruthy();
  });

  it("names the GPU in the summary", () => {
    expect(planFor("linux-x64", nvidia(580)).gpuSummary).toMatch(/RTX 4070.*fast/);
    expect(planFor("linux-x64", { kind: "none" }).gpuSummary).toMatch(/slowly/);
  });
});

describe("ProgressTracker", () => {
  it("adds up several downloads into one percentage", () => {
    let t = 0;
    const p = new ProgressTracker(1000, () => t);
    p.fileProgress(100, 100);      // file 1 done
    p.fileProgress(200, 400);      // file 2 halfway
    expect(p.doneBytes).toBe(300);
    expect(p.snapshot("x").pct).toBe(30);
    p.fileProgress(400, 400);
    p.fileProgress(50, 500);       // file 3 starts
    expect(p.doneBytes).toBe(550);
  });

  it("estimates time left from the download speed", () => {
    let t = 0;
    const p = new ProgressTracker(10_000_000, () => t);
    t = 1000; p.fileProgress(1_000_000, 10_000_000);   // 1 MB/s
    t = 2000; p.fileProgress(2_000_000, 10_000_000);
    const s = p.snapshot("x");
    expect(s.etaSec).toBeGreaterThan(6);
    expect(s.etaSec).toBeLessThan(10);
  });

  it("never claims 100% before the install finishes, even past the estimate", () => {
    const p = new ProgressTracker(100, () => 0);
    p.fileProgress(150, 150);
    expect(p.snapshot("x").pct).toBeLessThan(100);
  });
});
