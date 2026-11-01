import { describe, expect, it } from "vitest";
import { mergeCatalog, stripOwnerFields, validateTmdbDetail } from "./catalog";

describe("TMDB detail validation", () => {
  it("accepts a complete movie", () => {
    expect(validateTmdbDetail("movie/5", { id: 5, title: "A", poster_path: "/x.jpg", release_date: "2020-01-02", vote_average: 7.1 }).ok).toBe(true);
  });
  it("accepts missing optional fields", () => {
    expect(validateTmdbDetail("tv/9", { id: 9, name: "Show" }).ok).toBe(true);
  });
  it("rejects id mismatch", () => {
    expect(validateTmdbDetail("movie/5", { id: 6, title: "A" })).toEqual({ ok: false, reason: "ID_MISMATCH" });
  });
  it("rejects missing title", () => {
    expect(validateTmdbDetail("movie/5", { id: 5, title: "" })).toEqual({ ok: false, reason: "MISSING_TITLE" });
  });
  it("rejects unsafe image path", () => {
    expect(validateTmdbDetail("movie/5", { id: 5, title: "A", poster_path: "javascript:alert(1)" })).toEqual({ ok: false, reason: "BAD_IMAGE_PATH" });
  });
  it("rejects impossible rating and bad date", () => {
    expect(validateTmdbDetail("movie/5", { id: 5, title: "A", vote_average: 99 }).ok).toBe(false);
    expect(validateTmdbDetail("movie/5", { id: 5, title: "A", release_date: "soon" }).ok).toBe(false);
  });
  it("a TMDB refresh cannot overwrite owner fields", () => {
    const prev = { id: 5, title: "A", ownerId: "u1", streamKey: "media/a.mp4" };
    const merged = mergeCatalog(prev, stripOwnerFields({ id: 5, title: "B", ownerId: "evil", streamKey: "" }));
    expect(merged["ownerId"]).toBe("u1");
    expect(merged["streamKey"]).toBe("media/a.mp4");
    expect(merged["title"]).toBe("B");
  });
});
