// Deterministic, explainable, on-device taste engine. No AI, no account.
export type Signals = { genres: Record<string, number>; people: Record<string, number>; titles: Record<string, string> };
export const emptySignals = (): Signals => ({ genres: {}, people: {}, titles: {} });

export const WEIGHTS = { open: 1, save: 3, follow: 4, unsave: -2 } as const;
export type Action = keyof typeof WEIGHTS;

/** Applies one interaction. Weights are clamped to [-10, 50]. */
export function applySignal(s: Signals, action: Action, genreIds: number[], peopleIds: number[] = [], title?: { key: string; name: string }): Signals {
  const w = WEIGHTS[action];
  const clamp = (n: number) => Math.max(-10, Math.min(50, n));
  const genres = { ...s.genres }, people = { ...s.people }, titles = { ...s.titles };
  for (const g of genreIds) genres[g] = clamp((genres[g] ?? 0) + w);
  for (const p of peopleIds.slice(0, 5)) people[p] = clamp((people[p] ?? 0) + w);
  if (title && w > 0) for (const g of genreIds) titles[g] = title.name;
  return { genres, people, titles };
}

export function topGenres(s: Signals, n = 2): number[] {
  return Object.entries(s.genres).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0])).slice(0, n).map(([k]) => Number(k));
}

/** Score + human reason for a candidate item. */
export function scoreItem(s: Signals, item: { genre_ids: number[]; vote?: number | null }) {
  let score = 0, best = -1, bestW = 0;
  for (const g of item.genre_ids) {
    const w = s.genres[g] ?? 0;
    score += w;
    if (w > bestW) { bestW = w; best = g; }
  }
  score += (item.vote ?? 0) * 0.5;
  const reason = best >= 0 && s.titles[best] ? `Because you liked ${s.titles[best]}` : null;
  return { score: Math.round(score * 100) / 100, reason };
}

/** Release alerts: watchlist items releasing within `days` (or released today), each fired once. */
export function dueAlerts<T extends { key: string; date: string | null }>(items: T[], seen: string[], today: string, days = 7): T[] {
  const end = new Date(Date.parse(today) + days * 86400000).toISOString().slice(0, 10);
  const seenSet = new Set(seen);
  return items.filter((i) => i.date && i.date >= today && i.date <= end && !seenSet.has(`${i.key}@${i.date}`));
}
