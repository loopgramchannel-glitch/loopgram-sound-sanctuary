import { describe, it, expect } from "vitest";
import { allowedPulls } from "./auto-pulls";

describe("allowedPulls", () => {
  it("runs all 3 pulls when nothing is set", () => {
    expect(allowedPulls(null)).toEqual({ refresh: true, import: true, queue: true });
  });
  it("turning off the 3-hour refresh stops only that pull", () => {
    expect(allowedPulls({ autoRefresh: false })).toEqual({ refresh: false, import: true, queue: true });
  });
  it("turning off the catalog import stops only that pull", () => {
    expect(allowedPulls({ autoImport: false })).toEqual({ refresh: true, import: false, queue: true });
  });
  it("turning off the queue stops only that pull", () => {
    expect(allowedPulls({ autoQueue: false })).toEqual({ refresh: true, import: true, queue: false });
  });
  it("TMDB master switch off stops both TMDB pulls but keeps the queue", () => {
    expect(allowedPulls({ tmdbEnabled: false })).toEqual({ refresh: false, import: false, queue: true });
  });
});
