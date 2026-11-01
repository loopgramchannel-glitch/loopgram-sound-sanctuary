// Owner controls for Loop Party. Browser-safe schema; stored in Redis `site:live`, written only by the owner from Studio.
import { z } from "zod";

export const LiveSettings = z.object({
  partyOn: z.boolean().default(true),
  partyTmdb: z.boolean().default(true),
  partyPosts: z.boolean().default(true),
  partyChat: z.boolean().default(true),
  maxParties: z.number().int().min(1).max(100000).default(1000),
});
export type LiveSettingsT = z.infer<typeof LiveSettings>;

export function parseLive(raw: unknown): LiveSettingsT {
  const o = raw && typeof raw === "object" ? raw : {};
  const r = LiveSettings.safeParse(o);
  return r.success ? r.data : LiveSettings.parse({});
}
export const DEFAULT_LIVE = parseLive({});

/** Can a party be started (or kept open) for this kind of content? */
export function partyAllowed(s: Pick<LiveSettingsT, "partyOn" | "partyTmdb" | "partyPosts">, kind: "tmdb" | "post"): boolean {
  return s.partyOn && (kind === "tmdb" ? s.partyTmdb : s.partyPosts);
}
