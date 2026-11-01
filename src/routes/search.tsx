import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useInfiniteList } from "@/lib/infinite";
import { InfiniteFooter } from "@/components/InfiniteFooter";
import { ErrorBox, Grid, Page, type Item } from "@/components/lg";
import { Chip, PlayableChip } from "@/components/Browse";
import { useStore } from "@/lib/store";
import { AlgoliaResults } from "@/components/AlgoliaResults";

export const Route = createFileRoute("/search")({
  validateSearch: z.object({ q: z.string().max(100).catch("") }),
  head: () => ({
    meta: [
      { title: "Search — LoopgramChannel" },
      { name: "description", content: "Search millions of movies, TV shows and people." },
      { property: "og:title", content: "Search — LoopgramChannel" },
      { property: "og:description", content: "Search movies, TV shows and people." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();
  const nav = useNavigate();
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  useEffect(() => {
    const t = setTimeout(() => { if (text.trim() !== q) nav({ to: "/search", search: { q: text.trim() }, replace: true }); }, 400);
    return () => clearTimeout(t);
  }, [text]);
  // Dedupe by media type + TMDB ID only, so different titles sharing a name are all kept.
  const playable = useStore((s) => s.playableOnly);
  const [kind, setKind] = useState<"all" | "movie" | "tv" | "person">("all");
  const { q: res, items: all, sentinel } = useInfiniteList<Item>({
    key: ["search", q, playable], params: { a: "search", q, playable: playable ? "1" : undefined }, enabled: q.length > 0, pageLimit: 50,
    itemKey: (i) => `${i.media_type}:${i.id}`,
  });
  const items = kind === "all" ? all : all.filter((i) => i.media_type === kind);
  return (
    <Page>
      <div className="p-4">
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Search movies, TV, people" aria-label="Search"
          className="h-11 w-full rounded-full border bg-background px-5 outline-none focus:border-ring" />
        <div className="scrollbar-none mt-3 flex gap-2 overflow-x-auto">
          {([["all", "All"], ["movie", "Movies"], ["tv", "TV"], ["person", "People"]] as const).map(([k, l]) => <Chip key={k} active={kind === k} onClick={() => setKind(k)}>{l}</Chip>)}
          <span className="mx-1 w-px shrink-0 bg-border" /><PlayableChip />
        </div>
      </div>
      {q && <AlgoliaResults q={q} kind={kind} />}
      {!q ? <p className="px-4 text-sm text-muted-foreground">Type to search.</p>
        : res.isPending ? <p className="px-4 text-sm text-muted-foreground">Searching…</p>
        : res.isError && !items.length ? <ErrorBox error={res.error} retry={() => res.refetch()} />
        : items.length === 0 ? <p className="px-4 text-sm text-muted-foreground">No results for “{q}”.</p>
        : <Grid items={items} />}
      {q && <InfiniteFooter sentinel={sentinel} loading={res.isFetchingNextPage} error={res.isError} hasMore={!!res.hasNextPage} count={items.length} retry={() => res.fetchNextPage()} endText="No more results." />}
    </Page>
  );
}
