// LoopgramChannel speed engine: instant clicks (intent prefetch), slow-network detection, image priority.
import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { getState, setState } from "./store";

const done = new Set<string>();

/** Warm the detail-page data on hover/touch so the click opens instantly. Uses the same query key as the page. */
export function prefetchTitle(qc: QueryClient, type: string | undefined, id: number) {
  if (type === "person") return;
  const t = type === "tv" ? "tv" : "movie";
  const k = `${t}:${id}`;
  if (done.has(k) || isSlowNetwork()) return; // never prefetch on 2G / Data Saver
  done.add(k);
  if (done.size > 200) done.clear();
  if (active >= 2) { done.delete(k); return; } // cap: at most 2 prefetches in flight
  active++;
  void qc.prefetchQuery({ queryKey: ["title", t, String(id)], queryFn: () => api({ a: "title", type: t, id: String(id) }), staleTime: 30 * 60_000 })
    .finally(() => { active--; });
}
let active = 0;

/** Hover intent: prefetch only if the pointer stays 80ms; touch prefetches immediately. */
export function useIntentPrefetch(qc: QueryClient, type: string | undefined, id: number) {
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const go = () => prefetchTitle(qc, type, id);
  return {
    onMouseEnter: () => { clearTimeout(t.current); t.current = setTimeout(go, 80); },
    onMouseLeave: () => clearTimeout(t.current),
    onTouchStart: go,
  };
}

/** True on Data Saver or 2G-class connections. */
export function isSlowNetwork() {
  if (typeof navigator === "undefined") return false;
  const c = (navigator as any).connection;
  return !!c && (c.saveData === true || /(^|-)2g$/.test(c.effectiveType ?? ""));
}

/** Turn on low-data mode automatically once on slow networks (user can still switch it off). */
export function autoLowData() {
  if (!isSlowNetwork() || localStorage.getItem("loopgram:autolow")) return;
  localStorage.setItem("loopgram:autolow", "1");
  if (!getState().lowData) setState((s) => ({ ...s, lowData: true }));
}

/** First visible images load eagerly with high priority; the rest lazy. */
export function imgPriority(index: number) {
  return index < 2 ? ({ loading: "eager", fetchPriority: "high" } as const) : ({ loading: "lazy", fetchPriority: "low" } as const);
}

/** Prefetch when a card stays on screen ~600ms (idle time), so the tap opens from memory. */
export function useWarmOnView<T extends Element>(warm: () => void) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(([e]) => {
      clearTimeout(t);
      if (e?.isIntersecting) t = setTimeout(() => { warm(); io.disconnect(); }, 600);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => { clearTimeout(t); io.disconnect(); };
  }, []);
  return ref;
}
