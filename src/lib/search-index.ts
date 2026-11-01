// Pure, browser-safe helpers shared by the indexer and tests. No secrets here.
export const SEARCH_INDEX = "loopgram_titles";
export type MediaType = "movie" | "tv";
export type SearchRecord = {
  objectID: string; // `${type}:${tmdbId}` — stable, so re-indexing is idempotent
  type: MediaType;
  tmdb_id: number;
  title: string;
  original_title?: string;
  description: string;
  genres: string[];
  year: number | null;
  poster: string | null;
  backdrop: string | null;
  popularity: number;
  rating: number;
  views: number;
};
/** Index job contract. Today it runs inline on the server; a future SQS consumer can call the same handler. */
export type SearchJob =
  | { kind: "index"; type: MediaType; id: number }
  | { kind: "delete"; type: MediaType; id: number }
  | { kind: "reconcile" };

export const objectId = (type: MediaType, id: number) => `${type}:${id}`;

/** Builds a record from TMDB details, or null when the title must not appear in public search. */
export function toRecord(type: MediaType, d: any, views = 0): SearchRecord | null {
  if (!d || typeof d.id !== "number") return null;
  if (d.adult === true) return null; // never index adult titles
  const title = (type === "movie" ? d.title : d.name)?.trim();
  if (!title) return null;
  const date: string | undefined = type === "movie" ? d.release_date : d.first_air_date;
  const year = date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;
  const orig = type === "movie" ? d.original_title : d.original_name;
  return {
    objectID: objectId(type, d.id), type, tmdb_id: d.id, title,
    ...(orig && orig !== title ? { original_title: String(orig).slice(0, 200) } : {}),
    description: String(d.overview ?? "").slice(0, 1500),
    genres: Array.isArray(d.genres) ? d.genres.map((g: any) => g?.name).filter(Boolean) : [],
    year, poster: d.poster_path ?? null, backdrop: d.backdrop_path ?? null,
    popularity: Number(d.popularity) || 0, rating: Number(d.vote_average) || 0, views: Math.max(0, Math.floor(views)),
  };
}

/** Parses a DynamoDB view-counter key: TITLE#<type>#<id>[#S<n>] */
export function parseTitleKey(pk: string): { type: MediaType; id: number } | null {
  const m = /^TITLE#(movie|tv)#(\d{1,10})(#S\d+)?$/.exec(pk);
  return m ? { type: m[1] as MediaType, id: Number(m[2]) } : null;
}

/** Separate index for owner posts so TMDB titles and owner content stay distinguishable. */
export const POSTS_INDEX = "loopgram_posts";
export type PostRecord = { objectID: string; source: "owner"; title: string; text: string; category: string; image: string | null; hasVideo: boolean; createdAt: number };
export const POSTS_INDEX_SETTINGS = {
  searchableAttributes: ["title", "unordered(text)", "category"],
  attributesForFaceting: ["category", "source"],
  customRanking: ["desc(createdAt)"],
};
const stripTags = (s: string) => s.replace(/<[^>]*>/g, "").trim();
/** Only PUBLISHED posts are searchable; anything else (draft/rejected) returns null and must be removed. */
export function postRecord(p: { id: string; title: string; text: string; category: string; imageUrl: string; videoUrl: string; createdAt: number }, status: string): PostRecord | null {
  if (status !== "PUBLISHED" || !/^[a-z0-9-]{3,64}$/.test(p.id)) return null;
  const title = stripTags(p.title).slice(0, 200), text = stripTags(p.text).slice(0, 1500);
  if (!title && !text && !p.videoUrl && !p.imageUrl) return null;
  return { objectID: `post:${p.id}`, source: "owner", title, text, category: stripTags(p.category).slice(0, 40), image: p.imageUrl || null, hasVideo: Boolean(p.videoUrl), createdAt: p.createdAt };
}

export const INDEX_SETTINGS = {
  searchableAttributes: ["title", "original_title", "unordered(description)", "genres"],
  attributesForFaceting: ["searchable(genres)", "type", "year"],
  customRanking: ["desc(views)", "desc(popularity)"],
  typoTolerance: true,
  attributesToSnippet: ["description:20"],
  unretrievableAttributes: [] as string[],
};
