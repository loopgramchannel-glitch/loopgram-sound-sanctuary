import { Link } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { img } from "@/lib/api";
import { SEARCH_INDEX, type SearchRecord } from "@/lib/search-index";
import { Chip } from "@/components/Browse";

const APP = import.meta.env["VITE_ALGOLIA_APP_ID"] as string | undefined;
const KEY = import.meta.env["VITE_ALGOLIA_SEARCH_API_KEY"] as string | undefined;
type Hit = SearchRecord & { _snippetResult?: { description?: { value: string } } };
type Res = { hits: Hit[]; page: number; nbPages: number; nbHits: number; facets?: { genres?: Record<string, number> } };

async function search(q: string, type: string, genre: string, page: number, signal: AbortSignal): Promise<Res> {
  const facetFilters: string[][] = [];
  if (type === "movie" || type === "tv") facetFilters.push([`type:${type}`]);
  if (genre) facetFilters.push([`genres:${genre}`]);
  const r = await fetch(`https://${APP}-dsn.algolia.net/1/indexes/${SEARCH_INDEX}/query`, {
    method: "POST", signal,
    headers: { "X-Algolia-Application-Id": APP!, "X-Algolia-API-Key": KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, page, hitsPerPage: 12, facets: ["genres"], facetFilters, attributesToRetrieve: ["type", "tmdb_id", "title", "year", "poster", "genres"], attributesToSnippet: ["description:16"] }),
  });
  if (!r.ok) throw new Error(`Search ${r.status}`);
  return r.json();
}

/** "On LoopgramChannel" results from Algolia: typo-tolerant, ranked by views. Shown above the full catalogue search. */
export function AlgoliaResults({ q, kind }: { q: string; kind: string }) {
  const [genre, setGenre] = useState("");
  const enabled = !!APP && !!KEY && q.length > 0 && kind !== "person";
  const res = useInfiniteQuery({
    queryKey: ["algolia", q, kind, genre], enabled, staleTime: 60_000, retry: 1,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => search(q, kind, genre, pageParam, signal),
    getNextPageParam: (l) => (l.page + 1 < l.nbPages ? l.page + 1 : undefined),
  });
  if (!enabled) return null;
  const hits = res.data?.pages.flatMap((p) => p.hits) ?? [];
  const genres = Object.entries(res.data?.pages[0]?.facets?.genres ?? {}).slice(0, 8);
  return (
    <section className="px-4 pb-4" aria-label="On LoopgramChannel">
      <h2 className="mb-2 text-sm font-semibold">On LoopgramChannel</h2>
      {genres.length > 0 && (
        <div className="scrollbar-none mb-3 flex gap-2 overflow-x-auto">
          <Chip active={!genre} onClick={() => setGenre("")}>All genres</Chip>
          {genres.map(([g, n]) => <Chip key={g} active={genre === g} onClick={() => setGenre(genre === g ? "" : g)}>{g} · {n}</Chip>)}
        </div>
      )}
      {res.isPending ? <p className="text-sm text-muted-foreground">Searching LoopgramChannel…</p>
        : res.isError ? <p className="text-sm text-muted-foreground">LoopgramChannel search is unavailable right now. <button className="underline" onClick={() => res.refetch()}>Retry</button></p>
        : hits.length === 0 ? <p className="text-sm text-muted-foreground">Nothing on LoopgramChannel matches “{q}” yet.</p>
        : (
          <ul className="scrollbar-none flex gap-3 overflow-x-auto">
            {hits.map((h) => (
              <li key={h.objectID} className="w-28 shrink-0">
                <Link to="/t/$type/$id" params={{ type: h.type, id: String(h.tmdb_id) }} className="block">
                  <div className="aspect-[2/3] overflow-hidden rounded-md bg-muted">
                    {img(h.poster, "w185") && <img src={img(h.poster, "w185")!} alt={h.title} loading="lazy" className="h-full w-full object-cover" />}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs font-medium">{h.title}</p>
                  <p className="text-xs text-muted-foreground">{h.type === "tv" ? "TV" : "Movie"}{h.year ? ` · ${h.year}` : ""}</p>
                </Link>
              </li>
            ))}
            {res.hasNextPage && (
              <li className="flex w-28 shrink-0 items-center justify-center">
                <button className="text-sm underline" disabled={res.isFetchingNextPage} onClick={() => res.fetchNextPage()}>
                  {res.isFetchingNextPage ? "Loading…" : "More"}
                </button>
              </li>
            )}
          </ul>
        )}
    </section>
  );
}
