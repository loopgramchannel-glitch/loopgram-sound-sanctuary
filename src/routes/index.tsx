import { createFileRoute, Link } from "@tanstack/react-router";
import { getEditorial } from "@/lib/editorial.functions";
import { getPosts } from "@/lib/posts.functions";
import { PostThumb, SourceBadge, postIsShort, useRatios } from "@/components/PostView";
import { ShortsShelf } from "@/components/Shorts";
import { itemKey, resolveShelves } from "@/lib/editorial";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { scoreItem, topGenres } from "@/lib/taste";
import { ErrorBox, FeedCard, Page, Row, Skel, type Item } from "@/components/lg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LoopgramChannel — Endless movie & TV discovery" },
      { name: "description", content: "Scroll an endless feed of trending movies and TV shows, track releases and build your watchlist." },
      { property: "og:title", content: "LoopgramChannel — Endless movie & TV discovery" },
      { property: "og:description", content: "Trending movies and TV, release calendar, watchlist and daily games." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

type ListRes = { page: number; total_pages: number; results: Item[] };

function ForYou() {
  const signals = useStore((s) => s.signals);
  const genres = topGenres(signals, 2);
  const q = useQuery({
    queryKey: ["foryou", genres.join(",")],
    queryFn: () => api<ListRes>({ a: "discover", type: "movie", genre: genres.join("|") }),
    enabled: genres.length > 0, staleTime: 10 * 60_000,
  });
  if (!q.data) return null;
  const ranked = q.data.results.map((i) => ({ i, s: scoreItem(signals, { genre_ids: i.genre_ids ?? [], vote: i.vote ?? null }) })).sort((a, b) => b.s.score - a.s.score);
  return <Row title="Recommended for you" reason={ranked[0]?.s.reason ?? "Based on what you open and save, on this device only"} items={ranked.map((r) => r.i)} />;
}

function Home() {
  const rows = useQuery({ queryKey: ["rows"], queryFn: () => api<{ rows: { key: string; title: string; items: Item[] }[] }>({ a: "rows" }), staleTime: 5 * 60_000 });
  const feed = useInfiniteQuery({
    queryKey: ["feed"],
    queryFn: ({ pageParam, signal }) => api<ListRes>({ a: "feed", page: pageParam }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.total_pages ? last.page + 1 : undefined),
    staleTime: 10 * 60_000,
    enabled: !rows.isPending, // start the feed only after the top rows arrive
  });
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting && feed.hasNextPage && !feed.isFetchingNextPage && !feed.isError) feed.fetchNextPage();
    }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [feed.hasNextPage, feed.isFetchingNextPage, feed.isError, feed.fetchNextPage]);

  const ed = useQuery({ queryKey: ["editorial"], queryFn: () => getEditorial(), staleTime: 30_000 });
  const hidden = new Set((ed.data?.hidden ?? []).map(itemKey));
  const seen = new Set<string>();
  const items = (feed.data?.pages ?? []).flatMap((p) => p.results).filter((i) => { const k = `${i.media_type}${i.id}`; if (seen.has(k) || hidden.has(itemKey(i))) return false; seen.add(k); return true; });
  const base = new Map((rows.data?.rows ?? []).map((r) => [r.key, r.items]));
  const shelves = ed.data ? resolveShelves(ed.data).filter((s) => s.on) : (rows.data?.rows ?? []).map((r) => ({ key: r.key, title: r.title, on: true }));
  const shelfItems = (key: string): Item[] => {
    const list = key === "featured" ? ed.data?.featured : key.startsWith("col:") ? ed.data?.collections.find((c) => `col:${c.id}` === key)?.items : base.get(key);
    return (list ?? []).filter((i) => !hidden.has(itemKey(i))) as Item[];
  };

  return (
    <Page>
      <h1 className="sr-only">LoopgramChannel home</h1>
      <OwnerPosts />
      <ForYou />
      {shelves.map((sh) => sh.key === "originals" ? <Originals key="originals" title={sh.title} list={ed.data?.originals ?? []} /> : <Row key={sh.key} title={sh.title} items={shelfItems(sh.key)} />)}
      <h2 className="px-4 pb-2 pt-4 text-lg font-bold">Trending this week</h2>
      {feed.isPending || feed.isLoading ? <Skel /> : feed.isError && !items.length ? <ErrorBox error={feed.error} retry={() => feed.refetch()} /> : (
        <div className="grid grid-cols-1 gap-x-4 gap-y-8 px-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((i, idx) => (
            <div key={`${i.media_type}${i.id}`} className={idx === 12 ? "contents" : undefined}>
              <FeedCard item={i} index={idx} />
            </div>
          ))}
        </div>
      )}
      {feed.isFetchingNextPage && <div className="mt-6"><Skel n={3} /></div>}
      <div ref={sentinel} className="h-10" />
      {feed.isError && items.length > 0 && <ErrorBox error={feed.error} retry={() => feed.fetchNextPage()} />}
      {!feed.hasNextPage && items.length > 0 && <p className="py-6 text-center text-sm text-muted-foreground">You reached the end of trending.</p>}
    </Page>
  );
}

function Originals({ title, list }: { title: string; list: { id: string; title: string; poster: string; year: number | null }[] }) {
  if (!list.length) return null;
  return (
    <section className="py-3">
      <h2 className="px-4 text-lg font-bold">{title}</h2>
      <div className="scrollbar-none mt-2 flex gap-3 overflow-x-auto px-4 pb-1">
        {list.map((o) => (
          <Link key={o.id} to="/original/$id" params={{ id: o.id }} className="w-32 shrink-0 sm:w-40">
            {o.poster ? <img src={o.poster} alt={o.title} loading="lazy" className="aspect-[2/3] w-full rounded-lg bg-black object-contain" /> : <div className="grid aspect-[2/3] w-full place-items-center rounded-lg bg-secondary p-2 text-center text-sm font-semibold">{o.title}</div>}
            <div className="mt-1 truncate text-sm">{o.title}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function OwnerPosts() {
  const q = useQuery({ queryKey: ["posts"], queryFn: () => getPosts(), staleTime: 30_000 });
  const all = q.data ?? [];
  const ratios = useRatios(all.map((p) => p.videoUrl));
  const short = (p: (typeof all)[number]) => postIsShort(p, ratios);
  const list = all.filter((p) => !short(p)).slice(0, 12);
  const shorts = all.filter(short).slice(0, 20);
  if (!all.length) return null;
  return (
    <>
      {list.length > 0 && <section className="py-3">
        <div className="flex items-center justify-between px-4"><h2 className="text-lg font-bold">Latest videos</h2><Link to="/posts" className="text-sm text-primary">See all</Link></div>
        <div className="scrollbar-none mt-2 flex gap-3 overflow-x-auto px-4 pb-1">
          {list.map((p) => (
            <Link key={p.id} to="/post/$id" params={{ id: p.id }} className="relative w-64 shrink-0 sm:w-72">
              <PostThumb post={p} className="aspect-video w-full rounded-xl" /><SourceBadge url={p.videoUrl} className="absolute right-1.5 top-1.5 bg-background/90" />
              <div className="mt-2 flex gap-2">
                <img src="/icon.svg" alt="" className="h-8 w-8 shrink-0 rounded-full bg-secondary p-1" />
                <div className="min-w-0"><div className="line-clamp-2 text-sm font-semibold leading-snug">{p.title || p.text || "Video"}</div><div className="text-xs text-muted-foreground">LoopgramChannel</div></div>
              </div>
            </Link>
          ))}
        </div>
      </section>}
      <ShortsShelf posts={shorts} />
    </>
  );
}
