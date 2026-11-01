import { describe, expect, it } from "vitest";
import { catalogIdentity, mergeCatalog, stripOwnerFields, validateTmdbBody } from "./catalog";

describe("TMDB vault validation", () => {
  it("accepts a valid complete detail response", () => {
    expect(validateTmdbBody(JSON.stringify({ id: 550, title: "Fight Club", genres: [{ id: 1 }] })).ok).toBe(true);
  });
  it("accepts a response with optional fields missing", () => {
    expect(validateTmdbBody(JSON.stringify({ id: 550 })).ok).toBe(true);
  });
  it("rejects malformed JSON", () => {
    expect(validateTmdbBody("{oops")).toEqual({ ok: false, reason: "MALFORMED_JSON" });
  });
  it("rejects an invalid identifier", () => {
    expect(validateTmdbBody(JSON.stringify({ id: -3 }))).toEqual({ ok: false, reason: "BAD_ID" });
  });
  it("rejects upstream error payloads (revoked key / rate limit)", () => {
    expect(validateTmdbBody(JSON.stringify({ success: false, status_code: 7 })).ok).toBe(false);
  });
  it("rejects oversized bodies", () => {
    expect(validateTmdbBody(JSON.stringify({ id: 1, x: "a".repeat(400_000) }))).toEqual({ ok: false, reason: "TOO_LARGE" });
  });
  it("identifies detail paths only", () => {
    expect(catalogIdentity("movie/550")).toEqual({ type: "movie", id: 550 });
    expect(catalogIdentity("movie/550/credits")).toBeNull();
    expect(catalogIdentity("movie/abc")).toBeNull();
  });
});

describe("merge rules", () => {
  it("a partial refresh never erases good existing fields", () => {
    const merged = mergeCatalog({ id: 1, overview: "Good", genres: [{ id: 2 }] }, { id: 1, overview: "", genres: [] });
    expect(merged["overview"]).toBe("Good");
    expect(merged["genres"]).toEqual([{ id: 2 }]);
  });
  it("a refresh updates changed fields", () => {
    expect(mergeCatalog({ id: 1, vote_average: 7 }, { id: 1, vote_average: 8 })["vote_average"]).toBe(8);
  });
  it("TMDB data can never carry owner-owned fields", () => {
    const c = stripOwnerFields({ id: 1, streamKey: "x", ownerId: "u", status: "PUBLISHED", title: "T" });
    expect(c).toEqual({ id: 1, title: "T" });
  });
});
