// Single on-device store (localStorage) for watchlist, follows, taste signals, alerts, settings.
import { useSyncExternalStore } from "react";
import { applySignal, emptySignals, type Action, type Signals } from "./taste";

export type Saved = { key: string; id: number; type: "movie" | "tv"; title: string; poster: string | null; date: string | null; genre_ids: number[]; added: number };
export type State = {
  watchlist: Saved[]; follows: { id: number; name: string; profile: string | null }[];
  signals: Signals; seenAlerts: string[]; alerts: { key: string; text: string; at: number }[];
  lowData: boolean; game: Record<string, { picked: number; correct: boolean }>; recent: string[]; playableOnly: boolean;
};
const KEY = "loopgram:v1";
const initial = (): State => ({ watchlist: [], follows: [], signals: emptySignals(), seenAlerts: [], alerts: [], lowData: false, game: {}, recent: [], playableOnly: false });

let state: State = initial();
let loaded = false;
const subs = new Set<() => void>();
function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try { state = { ...initial(), ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { /* ignore */ }
}
export function setState(fn: (s: State) => State) {
  load();
  state = fn(state);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ }
  subs.forEach((f) => f());
}
const server = initial();
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => { load(); return sel(state); },
    () => sel(server),
  );
}
export const getState = () => { load(); return state; };

export function signal(action: Action, genreIds: number[], people: number[] = [], title?: { key: string; name: string }) {
  setState((s) => ({ ...s, signals: applySignal(s.signals, action, genreIds, people, title) }));
}
export function toggleSave(item: Omit<Saved, "key" | "added">) {
  const key = `${item.type}:${item.id}`;
  const has = getState().watchlist.some((w) => w.key === key);
  setState((s) => ({ ...s, watchlist: has ? s.watchlist.filter((w) => w.key !== key) : [{ ...item, key, added: Date.now() }, ...s.watchlist].slice(0, 500) }));
  signal(has ? "unsave" : "save", item.genre_ids, [], { key, name: item.title });
}
export function toggleFollow(p: { id: number; name: string; profile: string | null }) {
  const has = getState().follows.some((f) => f.id === p.id);
  setState((s) => ({ ...s, follows: has ? s.follows.filter((f) => f.id !== p.id) : [p, ...s.follows].slice(0, 300) }));
  if (!has) signal("follow", [], [p.id]);
}

export function setPlayableOnly(v: boolean) { setState((s) => ({ ...s, playableOnly: v })); }
