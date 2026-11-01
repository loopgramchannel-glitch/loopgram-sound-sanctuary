import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";

export type PageRes<T> = { page: number; total_pages: number; results: T[] };

/**
 * Shared infinite-scroll engine: TMDB page numbers, one request at a time (React Query dedupes),
 * aborts stale requests via signal, stops at the real last page, pauses on error until Retry,
 * dedupes by a stable key and caps pages kept in memory.
 */
export function useInfiniteList<T>(opts: {
  key: unknown[]; params: Record<string, string | number | undefined>; itemKey: (i: T) => string;
  enabled?: boolean; maxPages?: number; pageLimit?: number; staleTime?: number; rootMargin?: string;
}) {
  const { pageLimit = 500 } = opts;
  const q = useInfiniteQuery({
    queryKey: opts.key,
    // Deliberately NOT passing React Query's abort signal: when a list unmounts/remounts during navigation
    // the cancelled query reverted to "pending + idle" and never refetched, leaving skeletons forever.
    // Results land in the shared cache (unmounted components are never updated); a 15s timeout turns a hung
    // request into a real error with Retry instead of an endless skeleton.
    queryFn: ({ pageParam }) => api<PageRes<T>>({ ...opts.params, page: pageParam }, AbortSignal.timeout(15_000)),
    initialPageParam: 1,
    enabled: opts.enabled ?? true,
    maxPages: opts.maxPages ?? 10,
    staleTime: opts.staleTime ?? 15 * 60_000,
    getNextPageParam: (l) => {
      // A malformed page ends the feed instead of looping forever (pageLimit bounds empty-page runs).
      if (!l || !Array.isArray(l.results) || typeof l.page !== "number") return undefined;
      return l.page < l.total_pages && l.page < pageLimit ? l.page + 1 : undefined;
    },
  });
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = q;
  // Safety net: an enabled list with no data that isn't fetching would show skeletons forever — start it.
  const stuck = (opts.enabled ?? true) && q.isPending && q.fetchStatus === "idle";
  useEffect(() => { if (stuck) q.refetch(); }, [stuck]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || isFetchingNextPage || isError) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) fetchNextPage({ cancelRefetch: false }); }, { rootMargin: opts.rootMargin ?? "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage, opts.rootMargin]);
  const seen = new Set<string>();
  const items = (q.data?.pages ?? []).flatMap((p) => (Array.isArray(p?.results) ? p.results : []))
    .filter((i) => { const k = opts.itemKey(i); if (seen.has(k)) return false; seen.add(k); return true; });
  return { q, items, sentinel };
}
