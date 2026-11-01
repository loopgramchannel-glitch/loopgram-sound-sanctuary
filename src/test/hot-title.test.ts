import { describe, it, expect } from "vitest";
import { onceEvery } from "@/lib/backend.server";

describe("hot-title side-job throttle", () => {
  it("allows a key once per window, then again after it", () => {
    const realNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      expect(onceEvery("idx:movie:1", 600_000)).toBe(true);
      expect(onceEvery("idx:movie:1", 600_000)).toBe(false);
      expect(onceEvery("idx:movie:2", 600_000)).toBe(true);
      now = 1_000_000 + 600_001;
      expect(onceEvery("idx:movie:1", 600_000)).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });
});
