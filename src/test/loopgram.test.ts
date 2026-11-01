import { describe, it, expect } from "vitest";
import { resolveTmdb } from "@/lib/tmdb-allowlist";
import { viewShardKey, VIEW_SHARDS } from "@/lib/backend.server";
import { applySignal, emptySignals, scoreItem, dueAlerts, topGenres } from "@/lib/taste";
const P = (s = "") => new URLSearchParams(s);
describe("TMDB allow-list", () => {
  it("allows movie details and keeps supported params", () => {
    const r = resolveTmdb("movie/550", P("language=en-US&append_to_response=credits,videos&evil=1"));
    expect(r.ok && r.query.toString()).toBe("append_to_response=credits%2Cvideos&language=en-US");
  });
  it("blocks account and authentication", () => {
    expect(resolveTmdb("account/1", P()).ok).toBe(false);
    expect((resolveTmdb("authentication/token/new", P()) as any).status).toBe(403);
    expect((resolveTmdb("movie/550/account_states", P()) as any).status).toBe(403);
  });
  it("rejects unknown endpoints and bad ids", () => {
    expect((resolveTmdb("movie/abc", P()) as any).status).toBe(404);
    expect((resolveTmdb("../etc", P()) as any).status).toBe(400);
  });
  it("supports tv episode and trending", () => {
    expect(resolveTmdb("tv/1399/season/1/episode/2/credits", P()).ok).toBe(true);
    expect(resolveTmdb("trending/all/week", P("page=2")).ok).toBe(true);
    expect(resolveTmdb("trending/all/year", P()).ok).toBe(false);
  });
});
describe("taste engine", () => {
  it("is deterministic and explainable", () => {
    let s = applySignal(emptySignals(), "save", [28], [], { key: "movie:1", name: "Heat" });
    s = applySignal(s, "open", [35]);
    expect(s.genres).toEqual({ 28: 3, 35: 1 });
    expect(topGenres(s, 1)).toEqual([28]);
    expect(scoreItem(s, { genre_ids: [28], vote: 8 })).toEqual({ score: 7, reason: "Because you liked Heat" });
  });
});
describe("release alerts", () => {
  const items = [{ key: "movie:1", date: "2026-10-10" }, { key: "movie:2", date: "2026-12-01" }, { key: "movie:3", date: "2026-10-01" }];
  it("fires only for the next 7 days, once", () => {
    expect(dueAlerts(items, [], "2026-10-08").map((i) => i.key)).toEqual(["movie:1"]);
    expect(dueAlerts(items, ["movie:1@2026-10-10"], "2026-10-08")).toEqual([]);
  });
});
describe("view counter sharding", () => {
  it("keeps shard 0 as the legacy key and spreads others", () => {
    expect(viewShardKey("movie", 550, 0)).toBe("TITLE#movie#550");
    expect(viewShardKey("movie", 550, 3)).toBe("TITLE#movie#550#S3");
    const keys = new Set(Array.from({ length: 2000 }, () => viewShardKey("tv", 1)));
    expect(keys.size).toBe(VIEW_SHARDS);
  });
});

import { Editorial, resolveShelves } from "@/lib/editorial";
describe("homepage manager shelves", () => {
  it("keeps saved order, drops unknown shelves and appends new collections", () => {
    const ed = Editorial.parse({ shelves: [{ key: "tr", title: "Best", on: false }, { key: "gone", title: "x", on: true }], collections: [{ id: "abc", name: "Picks", items: [] }] });
    const r = resolveShelves(ed);
    expect(r[0]).toEqual({ key: "tr", title: "Best", on: false });
    expect(r.some((s) => s.key === "gone")).toBe(false);
    expect(r.at(-1)).toEqual({ key: "col:abc", title: "Picks", on: true });
  });
});

import { uploadIdFromKey } from "@/lib/playback.server";
describe("uploaded media ids", () => {
  it("maps movie and tv files to title ids", () => {
    expect(uploadIdFromKey("media/movie/550.mp4")).toBe("movie:550");
    expect(uploadIdFromKey("media/movie/550/index.m3u8")).toBe("movie:550");
    expect(uploadIdFromKey("media/tv/1399/s1e1.mp4")).toBe("tv:1399");
    expect(uploadIdFromKey("posters/x.jpg")).toBeNull();
  });
});
