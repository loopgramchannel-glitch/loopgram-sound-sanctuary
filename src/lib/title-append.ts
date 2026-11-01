// The exact TMDB detail request the title page makes. Shared so the background import fills the same
// saved entries that visitor pages read (same cache key = database hit instead of a live TMDB call).
export const TITLE_APPEND = {
  movie: "credits,videos,similar,recommendations,keywords,release_dates,external_ids,watch/providers",
  tv: "aggregate_credits,videos,similar,recommendations,keywords,content_ratings,external_ids,watch/providers",
} as const;
