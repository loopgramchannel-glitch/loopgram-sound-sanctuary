// Pure rules for the resumable TMDB import (testable, no I/O).

/** The TMDB lists we walk, in order. Each page yields up to 20 titles; TMDB caps lists at 500 pages. */
export const IMPORT_LISTS = [
  { path: "trending/all/week", maxPages: 50 },
  { path: "movie/popular", maxPages: 500 },
  { path: "tv/popular", maxPages: 500 },
  { path: "movie/top_rated", maxPages: 500 },
  { path: "tv/top_rated", maxPages: 500 },
  { path: "movie/now_playing", maxPages: 50 },
] as const;

export type ImportCursor = { list: number; page: number; round: number };
export const START: ImportCursor = { list: 0, page: 1, round: 1 };

export function parseCursor(raw: unknown): ImportCursor {
  try {
    const c = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Number.isInteger(c?.list) && Number.isInteger(c?.page) && c.list >= 0 && c.list < IMPORT_LISTS.length && c.page >= 1 && c.page <= 500) {
      return { list: c.list, page: c.page, round: Number.isInteger(c.round) && c.round > 0 ? c.round : 1 };
    }
  } catch { /* fall through */ }
  return { ...START };
}

/** Next position after a page. `totalPages` comes from TMDB; past the end we move to the next list, then start a new round. */
export function nextCursor(c: ImportCursor, totalPages: number): ImportCursor {
  const cap = Math.min(IMPORT_LISTS[c.list]!.maxPages, Math.max(1, Math.floor(totalPages) || 1));
  if (c.page < cap) return { ...c, page: c.page + 1 };
  if (c.list + 1 < IMPORT_LISTS.length) return { list: c.list + 1, page: 1, round: c.round };
  return { list: 0, page: 1, round: c.round + 1 };
}

/** Pulls valid, de-duplicated title identities out of a TMDB list page. Adult titles and people are skipped. */
export function titlesFromPage(listPath: string, body: unknown): { type: "movie" | "tv"; id: number }[] {
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const fixed = listPath.startsWith("movie/") ? "movie" : listPath.startsWith("tv/") ? "tv" : null;
  const seen = new Set<string>();
  const out: { type: "movie" | "tv"; id: number }[] = [];
  for (const r of results) {
    const type = fixed ?? (r?.media_type === "movie" || r?.media_type === "tv" ? r.media_type : null);
    if (!type || r?.adult === true || !Number.isInteger(r?.id) || r.id <= 0) continue;
    const k = `${type}:${r.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ type, id: r.id });
  }
  return out;
}

/** How often the newest lists are re-pulled from TMDB into the permanent store. */
export const REFRESH_EVERY_MS = 3 * 3600_000;
/** Pages re-pulled on each 3-hour refresh: the lists where new/changed titles appear. */
export const REFRESH_PAGES: { path: string; page: number }[] = [
  ...[1, 2, 3, 4, 5].map((page) => ({ path: "trending/all/week", page })),
  ...[1, 2, 3].map((page) => ({ path: "movie/now_playing", page })),
  ...[1, 2, 3].map((page) => ({ path: "movie/popular", page })),
  ...[1, 2, 3].map((page) => ({ path: "tv/popular", page })),
];
/** True when a new refresh round should start (never ran, or last start is at least 3 hours old). */
export function refreshDue(lastStart: number, now: number): boolean {
  return !Number.isFinite(lastStart) || lastStart <= 0 || now - lastStart >= REFRESH_EVERY_MS;
}
