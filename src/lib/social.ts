// Pure, browser-safe helpers for Loop Party. Tested in src/test/social.test.ts.

export const PARTY_CODE = /^[A-Z0-9]{6}$/;
export const YT_ID = /^[A-Za-z0-9_-]{6,20}$/;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion

export function makePartyCode(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}

/** `video` = YouTube id (TMDB trailers, YouTube posts); `file` = direct media URL (owner uploads). Exactly one is set. */
export type PartyState = { video: string; file?: string; title: string; type: "movie" | "tv" | "post"; id: number | string; playing: boolean; pos: number; at: number; v: number };

/** Turns an owner post's video link into party media: YouTube id, direct file, or null (not syncable). */
export function postPartyMedia(url: string): { video: string; file?: string } | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^(www\.|m\.)/, "");
  if (host === "youtu.be" || host === "youtube.com" || host === "youtube-nocookie.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    const id = host === "youtu.be" ? parts[0] : u.searchParams.get("v") ?? (["shorts", "embed", "live"].includes(parts[0] ?? "") ? parts[1] : undefined);
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? { video: id } : null;
  }
  return /\.(mp4|webm|mov|m4v|mp3|m4a|ogg|wav)(\?|$)/i.test(u.pathname) ? { video: "", file: url } : null;
}

/** Where the shared video should be "now", given the last host update. */
export function partyPosition(s: Pick<PartyState, "playing" | "pos" | "at">, now: number): number {
  return s.playing ? s.pos + Math.max(0, now - s.at) / 1000 : s.pos;
}
