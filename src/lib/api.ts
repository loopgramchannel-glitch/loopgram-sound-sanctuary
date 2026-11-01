// Browser-side client for the LoopgramChannel application API (never calls TMDB directly).
import { getState } from "./store";

// In-browser memory of recent answers: revisiting a page or row answers instantly (no network),
// and identical requests in flight share one fetch.
const MEMO_MS = 120_000;
const memo = new Map<string, { at: number; v: unknown }>();
const pending = new Map<string, Promise<unknown>>();

async function load(qs: string): Promise<unknown> {
  const r = await fetch(`/api/content?${qs}`);
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: `Error ${r.status}` }));
    throw new Error(e.error ?? `Error ${r.status}`);
  }
  return r.json();
}

export async function api<T = any>(params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)] as [string, string])).toString();
  const hit = memo.get(qs);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.v as T;
  let p = pending.get(qs);
  if (!p) {
    p = load(qs).then((v) => { if (memo.size > 300) memo.clear(); memo.set(qs, { at: Date.now(), v }); return v; })
      .finally(() => pending.delete(qs));
    pending.set(qs, p);
  }
  if (!signal) return p as Promise<T>;
  return new Promise<T>((ok, bad) => {
    if (signal.aborted) return bad(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", () => bad(new DOMException("Aborted", "AbortError")), { once: true });
    (p as Promise<T>).then(ok, bad);
  });
}

export function track(type: string, id: number, title: string, poster: string | null) {
  fetch("/api/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: "track", type, id, title, poster }), keepalive: true }).catch(() => {});
}

/** Direct TMDB image CDN URL (no proxying through R2). Low-data mode uses smaller sizes. */
export function img(path: string | null | undefined, size: "w92" | "w185" | "w342" | "w500" | "w780" = "w342") {
  if (!path || !/^\/[A-Za-z0-9_\-.]+$/.test(path)) return null;
  const low = typeof window !== "undefined" && getState().lowData;
  // Phones (< 640px) get one size step down: w342 -> w185, w780/w500 -> w342.
  const mobile = typeof window !== "undefined" && window.innerWidth < 640;
  const s = low ? (size === "w780" ? "w342" : "w185") : mobile ? (size === "w342" ? "w185" : size === "w185" ? "w185" : "w342") : size;
  return `https://image.tmdb.org/t/p/${s}${path}`;
}
