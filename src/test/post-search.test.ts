import { describe, expect, test } from "vitest";
import { postRecord } from "@/lib/search-index";
import { nextCursor, parseCursor, titlesFromPage } from "@/lib/tmdb-import";

const p = { id: "my-post", title: "Hello", text: "World", category: "news", imageUrl: "", videoUrl: "https://x/v.mp4", createdAt: 1 };

describe("owner posts in search", () => {
  test("published posts are indexed with a stable id (no duplicates)", () => {
    expect(postRecord(p, "PUBLISHED")?.objectID).toBe("post:my-post");
    expect(postRecord({ ...p, title: "Edited" }, "PUBLISHED")?.objectID).toBe("post:my-post");
  });
  test("drafts, rejected and deleted posts are never indexed", () => {
    for (const s of ["DRAFT", "REJECTED", "QUARANTINED", "DELETED"]) expect(postRecord(p, s)).toBeNull();
  });
  test("html is stripped from searchable text", () => {
    expect(postRecord({ ...p, title: "<script>x</script>Hi" }, "PUBLISHED")?.title).toBe("xHi");
  });
});

describe("resumable TMDB import", () => {
  test("bad saved position restarts from the beginning", () => {
    expect(parseCursor("{bad")).toEqual({ list: 0, page: 1, round: 1 });
  });
  test("moves to the next list after the last page, then starts a new round", () => {
    expect(nextCursor({ list: 0, page: 50, round: 1 }, 1000)).toEqual({ list: 1, page: 1, round: 1 });
    expect(nextCursor({ list: 5, page: 50, round: 1 }, 50)).toEqual({ list: 0, page: 1, round: 2 });
  });
  test("drops duplicates, adult titles and people from a page", () => {
    const body = { results: [{ id: 1, media_type: "movie" }, { id: 1, media_type: "movie" }, { id: 2, media_type: "movie", adult: true }, { id: 3, media_type: "person" }] };
    expect(titlesFromPage("trending/all/week", body)).toEqual([{ type: "movie", id: 1 }]);
  });
});
