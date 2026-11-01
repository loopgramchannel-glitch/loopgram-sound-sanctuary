import { describe, expect, it } from "vitest";
import { makePartyCode, PARTY_CODE, partyPosition, postPartyMedia } from "@/lib/social";
import { parseLive, partyAllowed } from "@/lib/live-settings";

describe("party", () => {
  it("codes are 6 safe characters", () => expect(PARTY_CODE.test(makePartyCode())).toBe(true));
  it("playing advances with time, paused does not", () => {
    expect(partyPosition({ playing: true, pos: 10, at: 0 }, 5000)).toBe(15);
    expect(partyPosition({ playing: false, pos: 10, at: 0 }, 5000)).toBe(10);
  });
});

describe("watch together for both sources", () => {
  it("owner upload becomes a file party", () => expect(postPartyMedia("https://pub-x.r2.dev/a/b.mp4")).toEqual({ video: "", file: "https://pub-x.r2.dev/a/b.mp4" }));
  it("youtube post becomes a youtube party", () => expect(postPartyMedia("https://youtu.be/dQw4w9WgXcQ")).toEqual({ video: "dQw4w9WgXcQ" }));
  it("other links are not syncable", () => expect(postPartyMedia("https://vimeo.com/123")).toBeNull());
  it("owner can switch off posts only", () => {
    const s = parseLive({ partyPosts: false });
    expect(partyAllowed(s, "tmdb")).toBe(true);
    expect(partyAllowed(s, "post")).toBe(false);
  });
  it("master switch blocks both", () => {
    const s = parseLive({ partyOn: false });
    expect(partyAllowed(s, "tmdb")).toBe(false);
    expect(partyAllowed(s, "post")).toBe(false);
  });
  it("old saved settings with streak/lounge fields still load", () => expect(parseLive({ streaksOn: true, lounges: {}, partyChat: false }).partyChat).toBe(false));
});
