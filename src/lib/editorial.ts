// Owner-curated homepage/editorial data (browser-safe schema + pure helpers). Stored in Redis `site:editorial`.
import { z } from "zod";

export const BASE_SHELVES = [
  { key: "featured", title: "Featured" },
  { key: "originals", title: "LoopgramChannel Originals" },
  { key: "lg", title: "Popular on LoopgramChannel" },
  { key: "pm", title: "Popular movies" },
  { key: "pt", title: "Popular TV" },
  { key: "np", title: "In theaters" },
  { key: "tr", title: "Top rated" },
] as const;

const EdItem = z.object({
  id: z.number().int().positive(),
  media_type: z.enum(["movie", "tv"]),
  title: z.string().max(300),
  poster_path: z.string().max(300).nullable(),
});
export type EdItemT = z.infer<typeof EdItem>;

const httpsUrl = z.string().trim().max(1000).refine((u) => u === "" || /^https:\/\//.test(u), "Must start with https://");

// TMDB-style metadata for the owner's own titles. Every new field has a default so older saved titles still load.
export const Episode = z.object({
  season: z.number().int().min(0).max(500),
  episode: z.number().int().min(1).max(5000),
  title: z.string().trim().max(200).default(""),
  overview: z.string().trim().max(2000).default(""),
  videoUrl: httpsUrl.default(""),
});
export type EpisodeT = z.infer<typeof Episode>;

export const Original = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,64}$/),
  kind: z.enum(["movie", "tv"]).default("movie"),
  title: z.string().trim().min(1).max(200),
  tagline: z.string().trim().max(200).default(""),
  year: z.number().int().min(1888).max(2100).nullable(),
  releaseDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(""),
  runtime: z.number().int().min(1).max(1000).nullable().default(null),
  rating: z.string().trim().max(20).default(""),
  genres: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  director: z.string().trim().max(200).default(""),
  cast: z.array(z.object({ name: z.string().trim().min(1).max(100), character: z.string().trim().max(100).default("") })).max(30).default([]),
  overview: z.string().trim().max(2000).default(""),
  poster: httpsUrl.default(""),
  backdrop: httpsUrl.default(""),
  videoUrl: httpsUrl.default(""),
  episodes: z.array(Episode).max(500).default([]),
  published: z.boolean().default(false),
});
export type OriginalT = z.infer<typeof Original>;

export const GENRES = ["Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy", "History", "Horror", "Music", "Mystery", "Romance", "Sci-Fi", "Thriller", "War", "Western", "Kids", "Reality", "Talk"] as const;

/** Every video link a title uses (main + episodes), for bucket checks on save. */
export const originalVideos = (o: OriginalT) => [o.videoUrl, ...o.episodes.map((e) => e.videoUrl)].filter(Boolean);

export const Editorial = z.object({
  shelves: z.array(z.object({ key: z.string().max(80), title: z.string().trim().max(80), on: z.boolean() })).max(80).default([]),
  featured: z.array(EdItem).max(40).default([]),
  collections: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{3,64}$/), name: z.string().trim().min(1).max(80), items: z.array(EdItem).max(40) })).max(30).default([]),
  hidden: z.array(EdItem).max(1000).default([]),
  originals: z.array(Original).max(200).default([]),
});
export type EditorialT = z.infer<typeof Editorial>;

export const itemKey = (i: { media_type?: string; id: number }) => `${i.media_type === "tv" ? "tv" : "movie"}:${i.id}`;

/** Full shelf order: saved shelves first, then any base shelf or collection not yet placed. Unknown/removed keys are dropped. */
export function resolveShelves(ed: EditorialT) {
  const known = new Map<string, string>(BASE_SHELVES.map((s) => [s.key, s.title]));
  for (const c of ed.collections) known.set(`col:${c.id}`, c.name);
  const out: { key: string; title: string; on: boolean }[] = [];
  const seen = new Set<string>();
  for (const s of ed.shelves) {
    if (!known.has(s.key) || seen.has(s.key)) continue;
    seen.add(s.key);
    out.push({ key: s.key, title: s.key.startsWith("col:") ? known.get(s.key)! : s.title || known.get(s.key)!, on: s.on });
  }
  for (const [key, title] of known) if (!seen.has(key)) out.push({ key, title, on: true });
  return out;
}

export function slug(s: string) {
  const b = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";
  return `${b}-${Math.random().toString(36).slice(2, 7)}`;
}
