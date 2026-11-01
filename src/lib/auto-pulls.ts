// Owner switches for the 3 background auto-pulls (stored in Redis site:settings). Pure, testable.
export type AutoPullSettings = { autoRefresh?: boolean; autoImport?: boolean; autoQueue?: boolean; tmdbEnabled?: boolean };

/** Which heartbeat pulls may run. Missing switches count as ON; TMDB master switch OFF stops both TMDB pulls. */
export function allowedPulls(s: AutoPullSettings | null | undefined) {
  const tmdb = s?.tmdbEnabled !== false;
  return {
    refresh: tmdb && s?.autoRefresh !== false,
    import: tmdb && s?.autoImport !== false,
    queue: s?.autoQueue !== false,
  };
}
