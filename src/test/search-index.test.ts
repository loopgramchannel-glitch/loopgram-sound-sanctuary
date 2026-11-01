import { describe, it, expect } from "vitest";
import { toRecord, parseTitleKey, objectId } from "@/lib/search-index";

describe("search index eligibility", () => {
  it("never indexes adult titles", () => {
    expect(toRecord("movie", { id: 1, title: "X", adult: true })).toBeNull();
  });
  it("skips titles with no name", () => {
    expect(toRecord("tv", { id: 2, name: "  " })).toBeNull();
  });
  it("uses a stable id so re-indexing overwrites instead of duplicating", () => {
    const r = toRecord("movie", { id: 550, title: "Fight Club", release_date: "1999-10-15", genres: [{ name: "Drama" }] }, 7)!;
    expect(r.objectID).toBe("movie:550");
    expect(r.year).toBe(1999);
    expect(r.genres).toEqual(["Drama"]);
    expect(r.views).toBe(7);
    expect(objectId("movie", 550)).toBe(r.objectID);
  });
});
describe("content table keys", () => {
  it("reads every view shard as the same title", () => {
    expect(parseTitleKey("TITLE#movie#1236045")).toEqual({ type: "movie", id: 1236045 });
    expect(parseTitleKey("TITLE#tv#42#S4")).toEqual({ type: "tv", id: 42 });
  });
  it("ignores unrelated rows", () => {
    expect(parseTitleKey("USER#1")).toBeNull();
    expect(parseTitleKey("TITLE#person#3")).toBeNull();
  });
});
