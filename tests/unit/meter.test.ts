import { describe, it, expect } from "vitest";
import { rmsToBars, BAR_COUNT } from "../../src/audio/meter.js";

describe("rmsToBars", () => {
  it("returns 0 for silence", () => {
    expect(rmsToBars(0)).toBe(0);
    expect(rmsToBars(-0)).toBe(0);
    expect(rmsToBars(NaN)).toBe(0);
  });

  it("returns 0 below the noise floor (-60 dBFS)", () => {
    // -70 dBFS RMS ≈ 0.000316
    expect(rmsToBars(0.000316)).toBe(0);
  });

  it("pegs at BAR_COUNT for loud signals", () => {
    expect(rmsToBars(1)).toBe(BAR_COUNT); // 0 dBFS
    expect(rmsToBars(0.5)).toBe(BAR_COUNT); // -6 dBFS
  });

  it("returns intermediate values across the range", () => {
    // -30 dBFS ≈ 0.0316 — should land somewhere in the middle.
    const mid = rmsToBars(0.0316);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(BAR_COUNT);
  });
});
