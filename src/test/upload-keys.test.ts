import { describe, expect, it } from "vitest";
import { isDeletableKey, uploadKey } from "@/lib/upload-keys";

describe("Studio upload destinations", () => {
  it("puts a movie file where the watch page looks for it", () => {
    expect(uploadKey({ kind: "movie", id: 550 }, "video/mp4", 1000, "r")).toEqual({ key: "media/movie/550.mp4" });
  });
  it("puts a TV episode file in its season/episode slot", () => {
    expect(uploadKey({ kind: "tv", id: 1399, season: 2, episode: 5 }, "video/mp4", 1000, "r")).toEqual({ key: "media/tv/1399/s2e5.mp4" });
  });
  it("accepts phone MOV videos for own titles", () => {
    expect(uploadKey({ kind: "original-video" }, "video/quicktime", 1000, "abc")).toEqual({ key: "media/originals/abc.mov" });
  });
  it("rejects non-MP4 files for movie slots", () => {
    expect("error" in uploadKey({ kind: "movie", id: 1 }, "video/webm", 1000, "r")).toBe(true);
  });
  it("rejects videos over 5 GB", () => {
    expect("error" in uploadKey({ kind: "original-video" }, "video/mp4", 5 * 1024 ** 3 + 1, "r")).toBe(true);
  });
  it("never lets Studio delete cached TMDB images", () => {
    expect(isDeletableKey("tmdb/w500/a.jpg")).toBe(false);
    expect(isDeletableKey("media/movie/550.mp4")).toBe(true);
    expect(isDeletableKey("media/../tmdb/x")).toBe(false);
  });
});
