import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cachedTrailer } from "@/lib/speed";
import { useEffect, useState } from "react";
import { z } from "zod";
import { api, img, track } from "@/lib/api";
import { useStore } from "@/lib/store";
import { useInfiniteList } from "@/lib/infinite";
import { InfiniteFooter } from "@/components/InfiniteFooter";
import { episodeNeighbors, neighbors } from "@/lib/playlist";
import { YouTubePlayer } from "@/components/YouTubePlayer";
import { StreamPlayer } from "@/components/StreamPlayer";
import { Providers } from "@/components/Providers";
import { ErrorBox, Page } from "@/components/lg";

export const Route = createFileRoute("/watch/$type/$id")({
  validateSearch: z.object({ v: z.string().regex(/^[\w-]{6,20}$/).optional().catch(undefined), s: z.coerce.number().int().min(0).max(500).optional().catch(undefined), e: z.coerce.number().int().min(1).max(5000).optional().catch(undefined), mode: z.enum(["full", "trailer"]).optional().catch(undefined) }),
  head: () => ({
    meta: [
      { title: "Watch trailers — LoopgramChannel" },
      { name: "description", content: "Watch official trailers and clips, then keep discovering related videos." },
      { property: "og:title", content: "Watch trailers — LoopgramChannel" },
      { property: "og:description", content: "Official trailers and clips with endless related videos." },
      { property: "og:type", content: "video.other" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WatchPage,
});

type Video = { key: string; name: string; type: string; official: boolean; status: string };
type ReelItem = { id: number; media_type: string; title: string; backdrop_path: string | null; poster_path: string | null; date: string | null; vote: number | null; video: Video };

function WatchPage() {
  const { type, id } = Route.useParams();
  const { v, s: season = 1, e: episode = 1, mode } = Route.useSearch();
  const t = type === "tv" ? "tv" : "movie";
  const q = useQuery({ queryKey: ["title", t, id], queryFn: () => api<any>({ a: "title", type: t, id }), staleTime: 30 * 60_000 });
  const sq = useQuery({ queryKey: ["stream", t, id, season, episode], queryFn: () => api<{ stream: { url: string; kind: "hls" | "mp4" } | null }>({ a: "stream", type: t, id, season: t === "tv" ? season : undefined, episode: t === "tv" ? episode : undefined }), staleTime: 10 * 60_000 });
  const [streamFailed, setStreamFailed] = useState(false);
  // A failed stream on one episode/title must not block the next one's full stream.
  useEffect(() => { setStreamFailed(false); }, [t, id, season, episode]);
  // A trailer key in the URL plays instantly; a full R2 stream hot-swaps in when it resolves (unless trailer mode).
  const stream = !streamFailed && mode !== "trailer" ? sq.data?.stream : null;
  const [failed, setFailed] = useState<string[]>([]);
  const [upNext, setUpNext] = useState<ReelItem | null>(null);
  const d = q.data;
  // TV: each episode's own videos come first, so Next/Prev changes what plays.
  const eq = useQuery({ queryKey: ["epvids", id, season, episode], enabled: t === "tv", queryFn: () => api<{ videos: Video[] }>({ a: "episode-videos", id, season, episode }), staleTime: 60 * 60_000 });
  const epVids: Video[] = eq.data?.videos ?? [];
  // Try every video in the embedded player; the player's onFail skips any that truly can't play.
  const all: Video[] = [...epVids, ...(d?.videos ?? []).filter((x: Video) => !epVids.some((y) => y.key === x.key))];
  const playable: Video[] = all.filter((x) => !failed.includes(x.key));
  const epPlayable = playable.filter((x) => epVids.some((y) => y.key === x.key));
  // A ?v= key plays immediately — the player never waits for title/episode data to arrive.
  const qc = useQueryClient();
  // No ?v=: use a trailer key warmed from the feed so the player still mounts at 0ms.
  const [warmKey] = useState(() => (t === "movie" && !v ? cachedTrailer(qc, t, id) : undefined));
  const vk = v ?? warmKey;
  const fromUrl: Video | undefined = vk && !failed.includes(vk) ? { key: vk, name: "Video", type: "Video", official: true, status: "" } : undefined;
  // TV without its own clip shows the series video, clearly labelled — never another episode's clip passed off as this one.
  const current = playable.find((x) => x.key === vk) ?? fromUrl
    ?? (t === "tv" ? epPlayable[0] ?? playable[0] : playable.find((x) => x.type === "Trailer") ?? playable[0]);
  const waitEp = t === "tv" && !v && eq.isPending;
  const instantKey = waitEp ? undefined : current?.key;
  const { index: vIdx, prev: prevVid, next: nextVid } = neighbors(playable, (x) => x.key === current?.key);
  const seriesClip = !!current && t === "tv" && !epVids.some((y) => y.key === current.key);

  useEffect(() => { if (d) { document.title = `${current?.name ?? "Trailer"} · ${d.title} — LoopgramChannel`; track(t, d.id, d.title, d.poster_path); } }, [d?.id, current?.key]);

  return (
    <Page>
      {/* Player keeps a fixed 16:9 box so the list below never resizes it. */}
      <div className="sticky top-14 z-20 bg-background md:static">
        {stream ? <StreamPlayer key={stream.url} url={stream.url} kind={stream.kind} title={d?.title ?? "Video"} poster={d ? img(d.backdrop_path, "w780") : null} onFail={() => setStreamFailed(true)} />
          : instantKey ? <YouTubePlayer key={instantKey} id={instantKey} title={current?.name ?? "Trailer"} onFail={() => setFailed((f) => [...f, instantKey])} />
          : (q.isPending || waitEp || eq.isPending) ? <div className="grid aspect-video w-full place-items-center bg-black"><div className="h-10 w-10 animate-spin rounded-full border-4 border-muted-foreground border-t-primary" aria-label="Loading video" /></div>
          : <div className="relative grid aspect-video w-full place-items-center overflow-hidden bg-muted p-4 text-center text-sm">
              {d?.backdrop_path && <img src={img(d.backdrop_path, "w780")!} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />}
              <p className="relative font-semibold">No playable video is available for this title yet.</p>
            </div>}
      </div>
      {q.isError ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : d && (
        <div className="px-4 pt-3">
          <h1 className="text-lg font-bold leading-snug">{t === "tv" ? `${d.title} · S${season} E${episode}` : stream ? d.title : current?.name ?? d.title}</h1>
          <p className="text-sm text-muted-foreground">
            {[stream ? (t === "tv" ? "Full episode" : "Full movie") : current && `${seriesClip ? "Series" : "Official"} ${current.type.toLowerCase()}: ${current.name.slice(0, 50)}`, d.date?.slice(0, 4), d.vote ? `★ ${d.vote.toFixed(1)}` : null].filter(Boolean).join(" · ")}
          </p>
          {!stream && (
            <div className="mt-2 flex items-center gap-2">
              {prevVid ? <Link to="/watch/$type/$id" params={{ type: t, id }} search={{ s: t === "tv" ? season : undefined, e: t === "tv" ? episode : undefined, v: prevVid.key }} replace className="rounded-full bg-secondary px-4 py-1.5 text-sm">← Previous video</Link>
                : <span className="rounded-full bg-secondary px-4 py-1.5 text-sm opacity-40">← Previous video</span>}
              {playable.length > 0 && <span className="text-xs text-muted-foreground">{vIdx + 1} / {playable.length}</span>}
              {nextVid ? <Link to="/watch/$type/$id" params={{ type: t, id }} search={{ s: t === "tv" ? season : undefined, e: t === "tv" ? episode : undefined, v: nextVid.key }} className="rounded-full bg-primary px-4 py-1.5 text-sm text-primary-foreground">Next video →</Link>
                : upNext ? <Link to="/watch/$type/$id" params={{ type: upNext.media_type === "tv" ? "tv" : "movie", id: String(upNext.id) }} search={{ v: upNext.video.key }} className="rounded-full bg-primary px-4 py-1.5 text-sm text-primary-foreground">Next video →</Link>
                : <span className="rounded-full bg-secondary px-4 py-1.5 text-sm opacity-40">Next video →</span>}
            </div>
          )}
          {sq.data?.stream && (
            <div className="mt-2 flex gap-2">
              <Link to="/watch/$type/$id" params={{ type: t, id }} search={{ s: season, e: episode }} replace className={`rounded-full px-4 py-1.5 text-sm ${stream ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{t === "tv" ? "Full episode" : "Full movie"}</Link>
              <Link to="/watch/$type/$id" params={{ type: t, id }} search={{ s: season, e: episode, mode: "trailer" }} replace className={`rounded-full px-4 py-1.5 text-sm ${!stream ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>Trailer</Link>
            </div>
          )}
          {playable.length > 1 && (
            <div className="scrollbar-none -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
              {playable.map((x) => (
                <Link key={x.key} to="/watch/$type/$id" params={{ type: t, id }} search={{ s: t === "tv" ? season : undefined, e: t === "tv" ? episode : undefined, v: x.key }} aria-current={x.key === current?.key}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${x.key === current?.key ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{x.type}: {x.name.slice(0, 40)}</Link>
              ))}
            </div>
          )}
          <Providers data={d.providers ?? null} title={t === "tv" ? "show" : "movie"} />
          {t === "tv" && d.season_list?.length > 0 && <Episodes id={id} seasons={d.season_list} season={season} episode={episode} />}
          <Link to="/t/$type/$id" params={{ type: t, id: String(d.id) }} className="mt-2 inline-block rounded-full bg-secondary px-4 py-1.5 text-sm">Title details →</Link>
        </div>
      )}
      {(d || q.isError) && <RelatedVideos key={`${t}:${id}`} type={t} id={id} onFirst={setUpNext} />}
    </Page>
  );
}

function RelatedVideos({ type, id, onFirst }: { type: "movie" | "tv"; id: string; onFirst: (i: ReelItem | null) => void }) {
  const lowData = useStore((s) => s.lowData);
  const { q, items, sentinel } = useInfiniteList<ReelItem>({
    key: ["reel", type, id], params: { a: "reel", type, id }, pageLimit: 20, maxPages: 8, staleTime: 30 * 60_000,
    itemKey: (i) => i.video.key,
  });
  const first = items.find((i) => !(String(i.id) === id && (i.media_type === "tv" ? "tv" : "movie") === type)) ?? null;
  useEffect(() => { onFirst(first); }, [first?.video.key]);
  return (
    <section className="pt-5">
      <h2 className="px-4 pb-2 text-base font-bold">Up next</h2>
      {q.isPending ? <div className="space-y-3 px-4">{[0, 1, 2].map((k) => <div key={k} className="aspect-video animate-pulse rounded-xl bg-muted sm:aspect-[4/1]" />)}</div>
        : q.isError && !items.length ? <ErrorBox error={q.error} retry={() => q.refetch()} />
        : items.length === 0 && !q.hasNextPage ? <p className="px-4 text-sm text-muted-foreground">No related videos found.</p>
        : (
          <ul className="grid grid-cols-1 gap-4 px-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((i) => {
              const thumb = img(i.backdrop_path ?? i.poster_path, "w780");
              if (!thumb) return null;
              return (
                <li key={i.video.key}>
                  <Link to="/watch/$type/$id" params={{ type: i.media_type === "tv" ? "tv" : "movie", id: String(i.id) }} search={{ v: i.video.key }} className="block">
                    <div className="aspect-video overflow-hidden rounded-xl bg-muted">
                      <img src={thumb} alt="" width={780} height={439} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(e) => { const li = e.currentTarget.closest("li"); if (li) li.style.display = "none"; }} className="h-full w-full bg-black object-contain" />
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug">{i.video.name}</p>
                    <p className="text-xs text-muted-foreground">{i.title} · {i.video.type}{i.date ? ` · ${i.date.slice(0, 4)}` : ""}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      <InfiniteFooter sentinel={sentinel} loading={q.isFetchingNextPage} error={q.isError} hasMore={!!q.hasNextPage} count={items.length} retry={() => q.fetchNextPage()} endText="No more related videos." />
    </section>
  );
}

function Episodes({ id, seasons, season, episode }: { id: string; seasons: { n: number; name: string }[]; season: number; episode: number }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["season", id, season], queryFn: () => api<{ episodes: { n: number; name: string; still: string | null }[] }>({ a: "season", id, season }), staleTime: 60 * 60_000 });
  const eps = q.data?.episodes ?? [];
  // Episode numbers can skip or continue across seasons (talk shows), so never assume 1..N.
  const idx = eps.findIndex((x) => x.n === episode);
  const sIdx = seasons.findIndex((x) => x.n === season);
  const nextSeason = seasons[sIdx + 1];
  const prevSeason = sIdx > 0 ? seasons[sIdx - 1] : undefined;
  type Eps = { episodes: { n: number }[] };
  const nq = useQuery({ queryKey: ["season", id, nextSeason?.n], enabled: !!nextSeason, queryFn: () => api<Eps>({ a: "season", id, season: nextSeason!.n }), staleTime: 60 * 60_000 });
  const pq = useQuery({ queryKey: ["season", id, prevSeason?.n], enabled: !!prevSeason, queryFn: () => api<Eps>({ a: "season", id, season: prevSeason!.n }), staleTime: 60 * 60_000 });
  // Only playable episodes are returned; land on one, and skip seasons that have none.
  useEffect(() => {
    if (!q.data) return;
    if (eps.length && idx === -1) navigate({ to: "/watch/$type/$id", params: { type: "tv", id }, search: { s: season, e: eps[0]!.n }, replace: true });
    else if (!eps.length && nextSeason) navigate({ to: "/watch/$type/$id", params: { type: "tv", id }, search: { s: nextSeason.n, e: undefined }, replace: true });
  }, [q.data, idx, season]);
  const cur = idx >= 0 ? eps[idx] : undefined;
  const nav = episodeNeighbors(season, episode, eps,
    prevSeason && { n: prevSeason.n, eps: pq.data?.episodes }, nextSeason && { n: nextSeason.n, eps: nq.data?.episodes });
  const epBtn = "rounded-full px-4 py-1.5 text-sm";
  const epNav = (
    <div className="mb-2 flex items-center gap-2">
      {nav.prev ? <Link to="/watch/$type/$id" params={{ type: "tv", id }} search={{ s: nav.prev.s, e: nav.prev.e }} className={`${epBtn} bg-secondary`}>← Previous episode</Link>
        : <span className={`${epBtn} bg-secondary opacity-40`} aria-disabled="true">← Previous episode</span>}
      {nav.next ? <Link to="/watch/$type/$id" params={{ type: "tv", id }} search={{ s: nav.next.s, e: nav.next.e }} className={`${epBtn} bg-primary text-primary-foreground`}>Next episode →</Link>
        : <span className={`${epBtn} bg-secondary opacity-40`} aria-disabled="true">Next episode →</span>}
    </div>
  );
  if (q.isPending) return <div className="mt-3 h-24 animate-pulse rounded-lg bg-muted" />;
  return (
    <div className="mt-3">
      {cur && (
        <div className="mb-2 flex items-center gap-3 rounded-lg bg-secondary p-2">
          {cur.still && <img src={img(cur.still, "w342")!} alt="" className="aspect-video w-24 rounded object-cover" />}
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Season {season} · Episode {cur.n}</p>
            <p className="line-clamp-2 text-sm font-semibold">{cur.name}</p>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="text-sm font-semibold" htmlFor="season">Season</label>
        <select id="season" value={season} onChange={(ev) => navigate({ to: "/watch/$type/$id", params: { type: "tv", id }, search: { s: Number(ev.target.value), e: undefined } })} className="rounded border bg-background px-2 py-1 text-sm">
          {seasons.map((x) => <option key={x.n} value={x.n}>{x.name}</option>)}
        </select>
      </div>
      {q.data && !eps.length && <p className="mt-2 text-xs text-muted-foreground">No aired episodes in this season yet.</p>}
    </div>
  );
}
