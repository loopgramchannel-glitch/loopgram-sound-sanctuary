import { describe, expect, it } from "vitest";
import { REFRESH_EVERY_MS, REFRESH_PAGES, refreshDue } from "./tmdb-import";

describe("3-hour TMDB refresh", () => {
  const now = 1_800_000_000_000;
  it("interval is exactly 3 hours", () => expect(REFRESH_EVERY_MS).toBe(10_800_000));
  it("runs when never run before", () => expect(refreshDue(0, now)).toBe(true));
  it("does not run before 3 hours pass", () => expect(refreshDue(now - 2.9 * 3600_000, now)).toBe(false));
  it("runs once 3 hours pass", () => expect(refreshDue(now - 3 * 3600_000, now)).toBe(true));
  it("covers trending and now playing", () => {
    expect(REFRESH_PAGES.some((p) => p.path === "trending/all/week")).toBe(true);
    expect(REFRESH_PAGES.some((p) => p.path === "movie/now_playing")).toBe(true);
  });
});

import { MAX_VAULT_BYTES, shrinkTmdbBody, validateTmdbBody } from "./catalog";
describe("oversized TV shows", () => {
  it("are trimmed to fit instead of refused", () => {
    const cast = Array.from({ length: 4000 }, (_, i) => ({ id: i + 1, name: "Actor " + i, roles: [{ character: "x".repeat(40) }, {}, {}] }));
    const big = JSON.stringify({ id: 1416, name: "Long Show", aggregate_credits: { cast, crew: cast } });
    expect(big.length).toBeGreaterThan(MAX_VAULT_BYTES);
    const out = shrinkTmdbBody(big);
    expect(validateTmdbBody(out).ok).toBe(true);
    expect(JSON.parse(out).name).toBe("Long Show");
  });
  it("leaves small answers untouched", () => {
    const small = JSON.stringify({ id: 5, title: "Hi" });
    expect(shrinkTmdbBody(small)).toBe(small);
  });
});
