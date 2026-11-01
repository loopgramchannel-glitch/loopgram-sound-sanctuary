import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Chip, DiscoverGrid, PlayableChip, prefetchDiscover, useGenres } from "@/components/Browse";
import { isSlowNetwork } from "@/lib/speed";
import { Page, type Item } from "@/components/lg";
import { api, img } from "@/lib/api";

export const Route = createFileRoute("/explore")({
  head: () => ({
    meta: [
      { title: "Explore — LoopgramChannel" },
      { name: "description", content: "Explore movies and TV by genre, popularity, rating and release date." },
      { property: "og:title", content: "Explore — LoopgramChannel" },
      { property: "og:description", content: "Browse movies and TV by genre." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Explore,
});

function Explore() {
  const [type, setType] = useState<"movie" | "tv">("movie");
  const [genre, setGenre] = useState<number | null>(null);
  const [sort, setSort] = useState("popularity.desc");
  const g = useGenres();
  const qc = useQueryClient();
  // Warm the first few categories in the background (skipped on slow networks) so taps feel instant.
  useEffect(() => {
    if (isSlowNetwork()) return;
    const list = g.data?.[type] ?? [];
    const t = setTimeout(() => list.slice(0, 6).forEach((x) => prefetchDiscover(qc, type, sort, String(x.id))), 800);
    return () => clearTimeout(t);
  }, [g.data, type, sort, qc]);
  const sorts = [["popularity.desc", "Popular"], ["vote_average.desc", "Top rated"], [type === "movie" ? "primary_release_date.desc" : "first_air_date.desc", "Newest"]];
  const switchType = (t: "movie" | "tv") => { setType(t); setGenre(null); setSort("popularity.desc"); };
  const top = useQuery({
    queryKey: ["explore-top", type],
    queryFn: () => api<{ results: Item[] }>({ a: "discover", type, sort: "popularity.desc" }),
    staleTime: 30 * 60_000,
  });
  const pool = (top.data?.results ?? []).filter((x) => x.backdrop_path);
  const hero = pool[0];
  const genreName = (id: number) => g.data?.[type].find((x) => x.id === id)?.name;
  // Give each genre card its own picture: prefer an unused title from that genre.
  const covers = new Map<number, string | null | undefined>();
  const used = new Set<number>();
  (g.data?.[type] ?? []).forEach((gen, i) => {
    const pick = pool.find((x) => !used.has(x.id) && x.genre_ids?.includes(gen.id)) ?? pool.find((x) => !used.has(x.id)) ?? pool[i % Math.max(pool.length, 1)];
    if (pick) used.add(pick.id);
    covers.set(gen.id, pick?.backdrop_path);
  });
  const coverFor = (id: number) => covers.get(id);
  const pickGenre = (id: number | null) => {
    setGenre(id);
    document.getElementById("explore-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Page title="Explore">
      <div className="w-full min-w-0 overflow-x-hidden">
        {/* Spotlight */}
        <section className="px-4">
          {hero ? (
            <Link to="/t/$type/$id" params={{ type, id: String(hero.id) }}
              className="group relative block aspect-[16/10] overflow-hidden rounded-2xl bg-secondary shadow-2xl sm:aspect-[21/9]">
              <img src={img(hero.backdrop_path, "w780") ?? ""} alt={hero.title} fetchPriority="high"
                className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary-foreground">
                  #1 Trending {type === "movie" ? "Movie" : "Show"}
                </span>
                <h2 className="mt-2 line-clamp-2 text-2xl font-black leading-tight sm:text-4xl">{hero.title}</h2>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  {hero.vote ? <span className="font-semibold text-foreground">★ {hero.vote.toFixed(1)}</span> : null}
                  {hero.date ? <span>{hero.date.slice(0, 4)}</span> : null}
                  {hero.genre_ids?.slice(0, 2).map((id) => genreName(id)).filter(Boolean).map((n) => <span key={n}>· {n}</span>)}
                </div>
                {hero.overview ? <p className="mt-2 line-clamp-2 max-w-xl text-sm text-muted-foreground">{hero.overview}</p> : null}
                <span className="mt-3 inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-bold text-background">▶ Watch now</span>
              </div>
            </Link>
          ) : (
            <div className="aspect-[16/10] animate-pulse rounded-2xl bg-secondary sm:aspect-[21/9]" />
          )}
        </section>

        {/* Type switch */}
        <div className="px-4 pt-4">
          <div className="grid grid-cols-2 gap-1 rounded-full bg-secondary p-1">
            {(["movie", "tv"] as const).map((t) => (
              <button key={t} onClick={() => switchType(t)} aria-pressed={type === t}
                className={`rounded-full py-2 text-sm font-bold transition ${type === t ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground"}`}>
                {t === "movie" ? "Movies" : "TV Shows"}
              </button>
            ))}
          </div>
        </div>

        {/* Top 10 rail */}
        {pool.length > 3 && (
          <section className="pt-6">
            <h2 className="px-4 pb-3 text-lg font-black">Top 10 this week</h2>
            <div className="flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
              {(top.data?.results ?? []).slice(0, 10).map((x, i) => (
                <Link key={x.id} to="/t/$type/$id" params={{ type, id: String(x.id) }} className="relative flex shrink-0 snap-start items-end">
                  <span className="-mr-3 text-7xl font-black leading-none text-transparent [-webkit-text-stroke:2px_var(--color-muted-foreground)]">{i + 1}</span>
                  <img src={img(x.poster_path, "w185") ?? ""} alt={x.title} loading="lazy"
                    className="relative h-36 w-24 rounded-lg bg-secondary object-cover shadow-lg" />
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Genre poster cards */}
        <section className="pt-6">
          <div className="flex items-center justify-between px-4 pb-3">
            <h2 className="text-lg font-black">Browse by genre</h2>
            {genre !== null && <button onClick={() => setGenre(null)} className="text-xs font-semibold text-primary">Clear</button>}
          </div>
          <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 lg:grid-cols-4">
            {g.data?.[type].map((x) => {
              const cover = img(coverFor(x.id), "w342");
              const active = genre === x.id;
              return (
                <button key={x.id} onClick={() => pickGenre(active ? null : x.id)} aria-pressed={active}
                  onPointerEnter={() => prefetchDiscover(qc, type, sort, String(x.id))} onTouchStart={() => prefetchDiscover(qc, type, sort, String(x.id))}
                  className={`group relative aspect-video overflow-hidden rounded-xl bg-secondary text-left transition ${active ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}>
                  {cover && <img src={cover} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-110" />}
                  <div className="absolute inset-0 bg-gradient-to-tr from-background/95 via-background/50 to-transparent" />
                  <span className="absolute bottom-2 left-3 text-base font-black drop-shadow">{x.name}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Results */}
        <section id="explore-results" className="scroll-mt-16 pt-8">
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
            <h2 className="mr-auto text-lg font-black">
              {genre !== null ? genreName(genre) ?? "Results" : `All ${type === "movie" ? "Movies" : "TV Shows"}`}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2 px-4 pb-4">
            {sorts.map(([k, l]) => <Chip key={k} active={sort === k} onClick={() => setSort(k!)}>{l}</Chip>)}
            <PlayableChip />
          </div>
          <DiscoverGrid type={type} sort={sort} genre={genre ? String(genre) : undefined} />
        </section>
      </div>
    </Page>
  );
}
