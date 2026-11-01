import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useInfiniteList } from "@/lib/infinite";
import { InfiniteFooter } from "@/components/InfiniteFooter";
import { ErrorBox, Grid, type Item } from "@/components/lg";
import { setPlayableOnly, useStore } from "@/lib/store";

/** Site-wide "Playable only" filter chip; hides titles with no working trailer. */
export function PlayableChip() {
  const on = useStore((s) => s.playableOnly);
  return <Chip active={on} onClick={() => setPlayableOnly(!on)}>▶ Playable only</Chip>;
}

/** Paged discover grid with bounded auto-loading. */
export function DiscoverGrid({ type, sort, genre }: { type: "movie" | "tv"; sort: string; genre?: string | undefined }) {
  const playable = useStore((s) => s.playableOnly);
  const { q, items, sentinel } = useInfiniteList<Item>({
    key: ["discover", type, sort, genre ?? "", playable], params: { a: "discover", type, sort, genre, playable: playable ? "1" : undefined },
    itemKey: (i) => String(i.id), maxPages: 10, staleTime: 30 * 60_000, rootMargin: "600px",
  });
  if (q.isError && !q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (!q.isPending && items.length === 0) return <p className="px-4 text-sm text-muted-foreground">No titles found.</p>;
  return <>{q.isPending ? <p className="px-4 text-sm text-muted-foreground">Loading…</p> : <Grid items={items} />}
    <InfiniteFooter sentinel={sentinel} loading={q.isFetchingNextPage} error={q.isError} hasMore={!!q.hasNextPage} count={items.length} retry={() => q.fetchNextPage()} /></>;
}

/** Endless related titles (recommendations, then similar) for a movie/TV detail page. */
export function RelatedGrid({ type, id, title }: { type: "movie" | "tv"; id: number | string; title: string }) {
  const { q, items, sentinel } = useInfiniteList<Item>({
    key: ["related", type, String(id)], params: { a: "related", type, id },
    itemKey: (i) => `${i.media_type}:${i.id}`, maxPages: 10, pageLimit: 20, staleTime: 30 * 60_000,
  });
  if (q.isPending) return <p className="px-4 pt-5 text-sm text-muted-foreground">Loading more like this…</p>;
  if (q.isError && !q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (!items.length) return null;
  return (
    <section className="pt-5">
      <h2 className="px-4 pb-2 text-lg font-bold">More like {title}</h2>
      <Grid items={items} />
      <InfiniteFooter sentinel={sentinel} loading={q.isFetchingNextPage} error={q.isError} hasMore={!!q.hasNextPage} count={items.length} retry={() => q.fetchNextPage()} endText="No more related titles." />
    </section>
  );
}

export function useGenres() {
  return useQuery({ queryKey: ["genres"], queryFn: () => api<{ movie: { id: number; name: string }[]; tv: { id: number; name: string }[] }>({ a: "genres" }), staleTime: Infinity });
}

/** Warm the first page of an Explore category (same key as DiscoverGrid) so tapping it shows instantly. */
export function prefetchDiscover(qc: QueryClient, type: "movie" | "tv", sort: string, genre?: string) {
  void qc.prefetchInfiniteQuery({
    queryKey: ["discover", type, sort, genre ?? ""],
    queryFn: ({ pageParam }) => api({ a: "discover", type, sort, genre, page: pageParam as number }),
    initialPageParam: 1, staleTime: 30 * 60_000,
  });
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} aria-pressed={active} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${active ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{children}</button>;
}
