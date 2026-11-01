import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Bookmark, BookmarkCheck, Share2, User, Users } from "lucide-react";
import { toast } from "sonner";
import { createParty } from "@/lib/social.functions";
import { partyAllowed } from "@/lib/live-settings";
import { useLive } from "@/lib/use-live";
import { shareLink } from "@/lib/share";
import { api, img, track } from "@/lib/api";
import { signal, toggleSave, useStore } from "@/lib/store";
import { ErrorBox, Page, Row } from "@/components/lg";
import { YouTubePlayer } from "@/components/YouTubePlayer";
import { RelatedGrid } from "@/components/Browse";
import { Providers } from "@/components/Providers";

export const Route = createFileRoute("/t/$type/$id")({
  head: () => ({
    meta: [
      { title: "Title details — LoopgramChannel" },
      { name: "description", content: "Cast, crew, trailers and similar titles on LoopgramChannel." },
      { property: "og:title", content: "Title details — LoopgramChannel" },
      { property: "og:description", content: "Cast, crew, trailers and similar titles." },
      { property: "og:type", content: "video.movie" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TitlePage,
});

function TitlePage() {
  const { type, id } = Route.useParams();
  const t = type === "tv" ? "tv" : "movie";
  const q = useQuery({ queryKey: ["title", t, id], queryFn: () => api({ a: "title", type: t, id }), staleTime: 30 * 60_000 });
  const sq = useQuery({ queryKey: ["stream", t, id, 1, 1], queryFn: () => api<{ stream: { url: string; kind: "hls" | "mp4" } | null }>({ a: "stream", type: t, id, season: t === "tv" ? 1 : undefined, episode: t === "tv" ? 1 : undefined }), staleTime: 10 * 60_000 });
  const key = `${t}:${id}`;
  const saved = useStore((s) => s.watchlist.some((w) => w.key === key));
  const lowData = useStore((s) => s.lowData);
  const [play, setPlay] = useState<string | null>(null);
  // Videos that failed in the embedded player this session (removed, private, region-blocked) — never retried.
  const [failed, setFailed] = useState<string[]>([]);
  const d = q.data;
  const navigate = useNavigate();
  const live = useLive();

  useEffect(() => {
    if (!d) return;
    document.title = `${d.title} — LoopgramChannel`;
    signal("open", d.genres.map((g: any) => g.id), d.cast.slice(0, 3).map((c: any) => c.id));
    track(t, d.id, d.title, d.poster_path);
  }, [d?.id]);

  if (q.isPending) return <Page><div className="aspect-video animate-pulse bg-muted" /></Page>;
  if (q.isError) return <Page><ErrorBox error={q.error} retry={() => q.refetch()} /></Page>;

  // Try every video in the embedded player; the player's onFail skips any that truly can't play.
  const playable = d.videos.filter((v: any) => !failed.includes(v.key));
  const trailer = playable.find((v: any) => v.type === "Trailer") ?? playable[0];
  const bg = img(d.backdrop_path, "w780");
  const share = () => shareLink({ title: d.title, text: `Check out ${d.title} on LoopgramChannel`, url: location.href });

  return (
    <Page>
      <div className="relative">
        {play ? (
          <YouTubePlayer key={play} id={play} onFail={() => {
            setFailed((f) => [...f, play]);
            const next = playable.find((v: any) => v.key !== play && !failed.includes(v.key));
            setPlay(next ? next.key : null);
          }} />
        ) : (
          <div className="aspect-video max-h-[60vh] w-full overflow-hidden bg-muted md:rounded-xl">
            {bg && <img src={bg} alt="" className="h-full w-full object-cover opacity-70" />}
          </div>
        )}
      </div>
      <div className="flex gap-4 px-4 pt-4">
        {d.poster_path && <img src={img(d.poster_path, "w185")!} alt="" className="hidden w-28 rounded-lg sm:block" />}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{d.title}</h1>
          {d.tagline && <p className="italic text-muted-foreground">{d.tagline}</p>}
          {d.original_title && d.original_title !== d.title && <p className="text-xs text-muted-foreground">Original title: {d.original_title}</p>}
          <p className="mt-1 text-sm text-muted-foreground">
            {[d.date?.slice(0, 4), d.runtime && `${d.runtime} min`, d.seasons && `${d.seasons} seasons`, d.episodes && `${d.episodes} episodes`, d.original_language?.toUpperCase(), d.vote && `★ ${d.vote.toFixed(1)} (${d.votes})`, d.status].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">{d.genres.map((g: any) => <span key={g.id} className="rounded-full bg-secondary px-3 py-1 text-xs">{g.name}</span>)}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(trailer || sq.data?.stream) ? <Link preload="intent" preloadDelay={0} to="/watch/$type/$id" params={{ type: t, id: String(d.id) }} search={trailer ? { v: trailer.key } : {}} className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground">▶ Play</Link>
              : <span aria-disabled className="cursor-not-allowed rounded-full bg-muted px-5 py-2 text-sm font-semibold text-muted-foreground">No video available</span>}
            {trailer && <Link preload="intent" preloadDelay={0} to="/watch/$type/$id" params={{ type: t, id: String(d.id) }} search={{ v: trailer.key, mode: "trailer" }} className="rounded-full bg-secondary px-5 py-2 text-sm font-semibold">▶ Trailer</Link>}
            <button onClick={() => toggleSave({ id: d.id, type: t, title: d.title, poster: d.poster_path, date: d.next_episode?.air_date ?? d.date, genre_ids: d.genres.map((g: any) => g.id) })} className="flex items-center gap-1.5 rounded-full bg-secondary px-4 py-2 text-sm">
              {saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}{saved ? "Saved" : "Save"}
            </button>
            <button onClick={() => { share() }} className="flex items-center gap-1.5 rounded-full bg-secondary px-4 py-2 text-sm"><Share2 className="h-4 w-4" />Share</button>
            {trailer && partyAllowed(live, "tmdb") && <button onClick={async () => {
              try {
                const r = await createParty({ data: { kind: "tmdb", video: trailer.key, title: d.title, type: t, id: d.id } });
                localStorage.setItem(`lg:party:${r.code}`, r.hostKey);
                navigate({ to: "/party/$code", params: { code: r.code } });
              } catch (e: any) { toast.error(e?.message ?? "Couldn't start a party"); }
            }} className="flex items-center gap-1.5 rounded-full bg-secondary px-4 py-2 text-sm"><Users className="h-4 w-4" />Watch together</button>}
            <Link to="/compare" search={{ a: `${t}:${d.id}` }} className="rounded-full bg-secondary px-4 py-2 text-sm">Compare</Link>
          </div>
        </div>
      </div>
      {!trailer && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground">
          <span className="flex-1">{d.videos.length ? "This title's videos can't play right now." : "No official trailer has been published for this title yet."}</span>
        </div>
      )}
      <p className="max-w-3xl px-4 pt-4 text-sm leading-relaxed">{d.overview || "No overview available."}</p>
      {(d.companies?.length > 0 || d.networks?.length > 0 || d.countries?.length > 0) && (
        <p className="px-4 pt-2 text-xs text-muted-foreground">
          {[d.networks?.length && `Network: ${d.networks.join(", ")}`, d.companies?.length && `Production: ${d.companies.join(", ")}`, d.countries?.length && `Country: ${d.countries.join(", ")}`].filter(Boolean).join(" · ")}
        </p>
      )}
      <div className="px-4"><Providers data={d.providers ?? null} title={t === "tv" ? "show" : "movie"} /></div>
      {d.season_list?.length > 0 && (
        <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 pt-3">
          {d.season_list.map((s: any) => <span key={s.n} className="shrink-0 rounded-lg bg-secondary px-3 py-1.5 text-xs">{s.name} · {s.episodes} ep{s.date ? ` · ${s.date.slice(0, 4)}` : ""}</span>)}
        </div>
      )}
      {d.next_episode && <p className="px-4 pt-2 text-sm">Next episode: <b>{d.next_episode.name}</b> on {d.next_episode.air_date}</p>}
      {d.belongs_to_collection && <Link to="/collection/$id" params={{ id: String(d.belongs_to_collection.id) }} className="mx-4 mt-3 inline-block rounded-full border px-4 py-1.5 text-sm">Part of {d.belongs_to_collection.name} →</Link>}

      <section className="pt-5">
        <h2 className="px-4 text-lg font-bold">Cast & Crew</h2>
        <div className="scrollbar-none mt-2 flex gap-3 overflow-x-auto px-4">
          {[...d.cast, ...d.creators.map((c: any) => ({ ...c, role: "Creator" })), ...d.crew.map((c: any) => ({ ...c, role: c.job }))].map((c: any, i: number) => (
            <Link key={`${c.id}-${i}`} to="/person/$id" params={{ id: String(c.id) }} className="w-20 shrink-0 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-muted">{c.profile_path && img(c.profile_path, "w185") ? <img src={img(c.profile_path, "w185")!} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = "none"; }} className="h-full w-full object-cover" /> : <User className="h-8 w-8 text-muted-foreground" aria-hidden />}</div>
              <p className="mt-1 line-clamp-2 text-xs font-medium">{c.name}</p>
              <p className="line-clamp-1 text-[10px] text-muted-foreground">{c.role}</p>
              {c.department && <p className="line-clamp-1 text-[9px] uppercase tracking-wide text-primary">{c.department}</p>}
              {c.episodes ? <p className="text-[9px] text-muted-foreground">{c.episodes} ep{c.episodes > 1 ? "s" : ""}</p> : null}
            </Link>
          ))}
        </div>
      </section>

      {playable.length > 0 && (
        <section className="pt-5">
          <h2 className="px-4 text-lg font-bold">Videos</h2>
          <div className="scrollbar-none mt-2 flex gap-3 overflow-x-auto px-4">
            {playable.map((v: any) => (
              <Link key={v.key} to="/watch/$type/$id" params={{ type: t, id: String(d.id) }} search={{ v: v.key }} className="w-56 shrink-0 text-left">
                <img src={`https://i.ytimg.com/vi/${v.key}/${lowData ? "default" : "mqdefault"}.jpg`} alt="" loading="lazy" className="aspect-video w-full rounded-lg bg-black object-contain" />
                <p className="mt-1 line-clamp-2 text-xs">{v.name}</p>
                <p className="text-[10px] text-muted-foreground">{v.type}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
      {d.keywords.length > 0 && <div className="flex flex-wrap gap-1.5 px-4 pt-5">{d.keywords.map((k: any) => <span key={k.id} className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">#{k.name}</span>)}</div>}
      <Row title="Recommended" items={d.recommendations} reason={`Because you viewed ${d.title}`} />
      <Row title="Similar" items={d.similar} />
      <RelatedGrid key={`${t}:${d.id}`} type={t} id={d.id} title={d.title} />
    </Page>
  );
}
