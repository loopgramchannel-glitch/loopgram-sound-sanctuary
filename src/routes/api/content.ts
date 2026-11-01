import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolveVideos, findStream, uploadedIds } from "@/lib/playback.server";
import { tmdbJson, tmdbEnabled, rateLimit, localRateLimit, clientIp, countView, popularOnLoopgram, onceEvery } from "@/lib/backend.server";
import { TITLE_APPEND } from "@/lib/title-append";

// LoopgramChannel application API: screen-shaped data assembled from the TMDB gateway helpers.
const page = z.coerce.number().int().min(1).max(500).default(1);
const id = z.coerce.number().int().min(1).max(1e10);
const media = z.enum(["movie", "tv"]);

function slim(r: any, fallbackType?: string) {
  return {
    id: r.id, media_type: r.media_type ?? fallbackType, title: r.title ?? r.name,
    poster_path: r.poster_path ?? r.profile_path ?? null, backdrop_path: r.backdrop_path ?? null,
    date: r.release_date ?? r.first_air_date ?? null, vote: r.vote_average ?? null,
    genre_ids: r.genre_ids ?? [], overview: r.overview ? String(r.overview).slice(0, 220) : "",
  };
}
const list = (d: any, t?: string) => ({
  page: d.page, total_pages: Math.min(d.total_pages ?? 1, 500),
  results: (d.results ?? []).filter((r: any) => r.media_type !== "person" || t === "any").map((r: any) => slim(r, t)),
});

// Global, always-on filter: keeps only titles that have a poster AND at least one YouTube video that passes
// resolveVideos() (not removed/embed-disabled). People are kept only when they have a profile photo.
// Video lookups go through tmdbJson (cached) and oEmbed checks are Redis-cached, so repeat loads stay fast.
const playCache = new Map<string, { exp: number; v: Promise<boolean> }>();
function isPlayable(t: string, id: number): Promise<boolean> {
  const k = `${t}:${id}`;
  const hit = playCache.get(k);
  if (hit && hit.exp > Date.now()) return hit.v;
  const rank: Record<string, number> = { Trailer: 0, Teaser: 1, Clip: 2 };
  const v = (async () => {
    // Same language rule as the title page: any language, so non-English titles with real videos are kept.
    const d = await tmdbJson(`${t}/${id}/videos`, { include_video_language: "en,null,tl,es,fr,de,hi,ko,ja,pt,it,ru,zh,ar,tr,id,th" }).catch(() => ({ results: [] }));
    const cand = (d.results ?? []).filter((y: any) => y.site === "YouTube" && y.key)
      .sort((a: any, b: any) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9) || Number(!!b.official) - Number(!!a.official)).slice(0, 3);
    if (!cand.length) return false;
    return (await resolveVideos(cand)).some((y) => y.status === "ok");
  })().catch(() => false);
  playCache.set(k, { exp: Date.now() + 30 * 60_000, v });
  if (playCache.size > 5000) playCache.delete(playCache.keys().next().value!);
  return v;
}
/** Fast list filter: poster + overview only, no TMDB video / YouTube calls. Strict check runs on title/reel/watch. */
function quickCheck(items: any[], fallbackType?: string, limit = 60) {
  return items.filter((x: any) => {
    const t = x.media_type ?? fallbackType;
    if (t === "person") return Boolean(x.poster_path);
    return (t === "movie" || t === "tv") && Boolean(x.poster_path && x.overview);
  }).slice(0, limit);
}
// Universal readiness filter: every list on the site passes through here. A title is shown only when it has
// a title, overview, poster AND a verified playable video. People need a name and photo.
async function keepPlayable(items: any[], fallbackType?: string, limit = 60) {
  const uploads = await uploadedIds().catch(() => new Set<string>());
  const ok = await Promise.all(items.map(async (x: any) => {
    const t = x.media_type ?? fallbackType;
    if (!x.title || !x.poster_path) return false; // slim() maps name -> title, profile_path -> poster_path
    if (t === "person") return true;
    if (t !== "movie" && t !== "tv") return false;
    if (!x.overview) return false;
    if (uploads.has(`${t}:${x.id}`)) return true; // owner-uploaded full video counts as playable
    return isPlayable(t, x.id);
  }));
  return items.filter((_, k) => ok[k]).slice(0, limit);
}

const today = () => new Date().toISOString().slice(0, 10);
function dayHash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

// Process-local memo of whole responses for static, non-personal reads (served from memory on repeat loads).
const MEMO_TTL: Record<string, number> = { rows: 15 * 60_000, feed: 10 * 60_000, discover: 10 * 60_000, genres: 6 * 3600_000, title: 5 * 60_000, season: 30 * 60_000 };
const memo = new Map<string, { exp: number; v: Promise<any> }>();
// When the owner switches TMDB off, catalog lists come back empty so the site runs on owner content only.
const OFF_SHAPE: Record<string, unknown> = {
  feed: { page: 1, total_pages: 1, results: [] }, discover: { page: 1, total_pages: 1, results: [] },
  search: { page: 1, total_pages: 1, results: [] }, rows: { rows: [] }, genres: { genres: [] },
};
async function handleCached(a: string, q: URLSearchParams) {
  if (a in OFF_SHAPE && !(await tmdbEnabled())) return OFF_SHAPE[a] as any;
  return handleCachedInner(a, q);
}
function handleCachedInner(a: string, q: URLSearchParams) {
  const ttl = MEMO_TTL[a];
  if (!ttl) return handle(a, q);
  const k = `${a}?${[...q.entries()].sort().map(([x, y]) => `${x}=${y}`).join("&")}`;
  const hit = memo.get(k);
  if (hit && hit.exp > Date.now()) return hit.v;
  const v = handle(a, q);
  memo.set(k, { exp: Date.now() + ttl, v });
  v.then((r) => { if (r?.degraded) memo.delete(k); }, () => memo.delete(k));
  if (memo.size > 300) memo.delete(memo.keys().next().value!);
  return v;
}
const aborted = (request: Request) => Boolean(request.signal?.aborted);
const gone = () => new Response(null, { status: 499 });

async function handle(a: string, q: URLSearchParams) {
  const g = (k: string) => q.get(k) ?? undefined;
  switch (a) {
    case "feed": {
      const p = page.parse(g("page"));
      const r = list(await tmdbJson("trending/all/week", { page: p }));
      // Only titles with a verified playable video reach the home feed.
      return { ...r, results: await keepPlayable(quickCheck(r.results)) };
    }
    case "rows": {
      const [pm, pt, np, tr, lg] = await Promise.all([
        tmdbJson("movie/popular"), tmdbJson("tv/popular"), tmdbJson("movie/now_playing"),
        tmdbJson("movie/top_rated"), popularOnLoopgram().catch(() => []),
      ]);
      const [lgOk, pmOk, ptOk, npOk, trOk] = await Promise.all([
        keepPlayable(quickCheck((lg as any[]).slice(0, 30))), keepPlayable(quickCheck(list(pm, "movie").results, "movie"), "movie"),
        keepPlayable(quickCheck(list(pt, "tv").results, "tv"), "tv"), keepPlayable(quickCheck(list(np, "movie").results, "movie"), "movie"),
        keepPlayable(quickCheck(list(tr, "movie").results, "movie"), "movie"),
      ]);
      return {
        rows: [
          { key: "lg", title: "Popular on LoopgramChannel", items: lgOk },
          { key: "pm", title: "Popular movies", items: pmOk },
          { key: "pt", title: "Popular TV", items: ptOk },
          { key: "np", title: "In theaters", items: npOk },
          { key: "tr", title: "Top rated", items: trOk },
        ].filter((r) => r.items.length),
      };
    }
    case "search": {
      const query = z.string().trim().min(1).max(100).parse(g("q"));
      const d = await tmdbJson("search/multi", { query, page: page.parse(g("page")), include_adult: "false" });
      const r = list(d, "any");
      // "Playable only" must hold on search too: drop titles without a verified playable video.
      const base = quickCheck(r.results, undefined, 50);
      // Only titles with a verified playable video are ever shown.
      return { ...r, results: await keepPlayable(base, undefined, 50) };
    }
    case "discover": {
      const t = media.parse(g("type") ?? "movie");
      const sort = z.enum(["popularity.desc", "vote_average.desc", "primary_release_date.desc", "first_air_date.desc", "title.asc", "name.asc", "original_title.asc"]).parse(g("sort") ?? "popularity.desc");
      const genre = g("genre") ? z.string().regex(/^[\d,|]{1,60}$/).parse(g("genre")) : undefined;
      const newest = sort.endsWith("date.desc");
      const minVotes = sort.startsWith("vote") || sort.endsWith(".asc") ? 50 : newest ? 3 : undefined;
      // Cap "Newest" at today so unreleased placeholders (no trailers yet) never appear.
      const today = new Date().toISOString().slice(0, 10);
      const dateCap = newest ? (t === "movie" ? { "primary_release_date.lte": today } : { "first_air_date.lte": today }) : {};
      const r = list(await tmdbJson(`discover/${t}`, {
        page: page.parse(g("page")), sort_by: sort, with_genres: genre, include_adult: "false",
        "vote_count.gte": minVotes, ...dateCap,
      }), t);
      // Only titles with a verified in-site playable video reach the UI.
      return { ...r, results: await keepPlayable(r.results, t, 50) };
    }
    case "genres": {
      const [m, t] = await Promise.all([tmdbJson("genre/movie/list"), tmdbJson("genre/tv/list")]);
      return { movie: m.genres, tv: t.genres };
    }
    case "title": {
      const t = media.parse(g("type")), i = id.parse(g("id"));
      // watch/providers: official licensed services (Netflix, Prime, etc.) where the full title is available.
      const d = await tmdbJson(`${t}/${i}`, { append_to_response: TITLE_APPEND[t] });
      const credits = d.credits ?? d.aggregate_credits ?? {};
      // TMDB's default video list is English-only; also fetch original-language and language-less videos
      // so non-English titles don't lose their official trailers.
      const vl = ["en", "null", d.original_language, "tl", "es", "fr", "de", "hi", "ko", "ja", "pt", "it", "ru", "zh", "ar", "tr", "id", "th"].filter((x, k, a) => x && /^[a-z]{2}$|^null$/.test(x) && a.indexOf(x) === k).join(",");
      const more = await tmdbJson(`${t}/${i}/videos`, { include_video_language: vl }).catch(() => ({ results: [] }));
      // Similar/recommendations stay slim (no per-title video checks) so the title response isn't blocked on ~36 lookups.
      const videos = (await resolveVideos([...(d.videos?.results ?? []), ...(more.results ?? [])])).filter((v) => v.status === "ok");
      const [similar, recommendations] = await Promise.all([
        keepPlayable(quickCheck(list(d.similar ?? {}, t).results.slice(0, 18), t, 18), t, 18),
        keepPlayable(quickCheck(list(d.recommendations ?? {}, t).results.slice(0, 18), t, 18), t, 18),
      ]);
      return {
        id: d.id, media_type: t, title: d.title ?? d.name, tagline: d.tagline, overview: d.overview,
        poster_path: d.poster_path, backdrop_path: d.backdrop_path, date: d.release_date ?? d.first_air_date,
        next_episode: d.next_episode_to_air ?? null, status: d.status,
        runtime: d.runtime ?? d.episode_run_time?.[0] ?? null, vote: d.vote_average, votes: d.vote_count,
        genres: d.genres ?? [], seasons: d.number_of_seasons ?? null, belongs_to_collection: d.belongs_to_collection ?? null,
        budget: d.budget ?? null, revenue: d.revenue ?? null, languages: d.spoken_languages?.map((l: any) => l.english_name) ?? [],
        keywords: (d.keywords?.keywords ?? d.keywords?.results ?? []).slice(0, 15),
        // Photo-only cast: every circle in the carousel shows a verified headshot.
        cast: (credits.cast ?? [])
          .filter((c: any) => Boolean(c.profile_path))
          .slice(0, 24)
          .map((c: any) => ({ id: c.id, name: c.name, role: c.character ?? c.roles?.[0]?.character, profile_path: c.profile_path,
            department: "Acting", order: c.order ?? null, episodes: c.total_episode_count ?? null })),
        // Key creative roles only, directors first, photo-only — but never drop the Director credit entirely.
        crew: (() => {
          const key = (credits.crew ?? []).filter((c: any) => ["Director", "Creator", "Screenplay", "Producer"].includes(c.job ?? c.jobs?.[0]?.job));
          const withPhotos = key.filter((c: any) => Boolean(c.profile_path));
          const kept = withPhotos.length ? withPhotos : key.filter((c: any) => (c.job ?? c.jobs?.[0]?.job) === "Director").slice(0, 2);
          return kept
            .sort((a: any, b: any) => ((a.job === "Director" ? 0 : 1) - (b.job === "Director" ? 0 : 1)) || ((b.profile_path ? 1 : 0) - (a.profile_path ? 1 : 0)))
            .slice(0, 12)
            .map((c: any) => ({ id: c.id, name: c.name, job: c.job ?? c.jobs?.[0]?.job, profile_path: c.profile_path ?? null,
              department: c.department ?? null, episodes: c.total_episode_count ?? null }));
        })(),
        creators: (d.created_by ?? []).filter((c: any) => Boolean(c.profile_path)).map((c: any) => ({ id: c.id, name: c.name, profile_path: c.profile_path ?? null })),
        videos,
        original_title: d.original_title ?? d.original_name ?? null, original_language: d.original_language ?? null,
        episodes: d.number_of_episodes ?? null, networks: (d.networks ?? []).map((n: any) => n.name),
        companies: (d.production_companies ?? []).map((c: any) => c.name).slice(0, 6),
        countries: (d.production_countries ?? d.origin_country ?? []).map((c: any) => c.name ?? c),
        season_list: (d.seasons ?? []).map((s: any) => ({ n: s.season_number, name: s.name, episodes: s.episode_count, date: s.air_date })),
        imdb_id: d.external_ids?.imdb_id ?? d.imdb_id ?? null, homepage: d.homepage || null,
        similar, recommendations,
        providers: (() => {
          const all = d["watch/providers"]?.results ?? {};
          const r = all.US ?? all.GB ?? Object.values(all)[0] as any;
          if (!r) return null;
          const seen = new Set<number>();
          const pick = (arr: any[] = [], kind: string) => arr.filter((p) => !seen.has(p.provider_id) && seen.add(p.provider_id))
            .map((p) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path, kind }));
          const items = [...pick(r.flatrate, "Stream"), ...pick(r.free, "Free"), ...pick(r.ads, "Free with ads"), ...pick(r.rent, "Rent"), ...pick(r.buy, "Buy")].slice(0, 12);
          return items.length ? { link: r.link as string, items } : null;
        })(),
      };
    }
    case "related": {
      // Paged related titles: TMDB recommendations, falling back to "similar" when a title has none.
      const t = media.parse(g("type")), i = id.parse(g("id")), p = page.parse(g("page"));
      let d = await tmdbJson(`${t}/${i}/recommendations`, { page: p });
      if (!(d.total_results > 0)) d = await tmdbJson(`${t}/${i}/similar`, { page: p });
      const r = list(d, t);
      return { ...r, total_pages: Math.min(r.total_pages, 20), results: await keepPlayable(r.results.filter((x: any) => x.id !== i), t) };
    }
    case "reel": {
      // Related-video feed for the watch page: official YouTube videos of related titles, one per title,
      // each passing the resolveVideos() playability check. Titles with no playable video are skipped (never faked).
      const t = media.parse(g("type")), i = id.parse(g("id")), p = page.parse(g("page"));
      let d = await tmdbJson(`${t}/${i}/recommendations`, { page: p });
      if (!(d.total_results > 0)) d = await tmdbJson(`${t}/${i}/similar`, { page: p });
      const r = list(d, t);
      const rank: Record<string, number> = { Trailer: 0, Teaser: 1, Clip: 2 };
      // Only the top 5 related titles get video lookups: far fewer TMDB + oEmbed round trips per page.
      const out = await Promise.all(r.results.filter((x: any) => x.id !== i).slice(0, 5).map(async (x: any) => {
        const v = await tmdbJson(`${t}/${x.id}/videos`).catch(() => ({ results: [] }));
        const cand = (v.results ?? []).filter((y: any) => y.site === "YouTube" && y.key)
          .sort((a: any, b: any) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9) || Number(!!b.official) - Number(!!a.official)).slice(0, 2);
        if (!cand.length) return null;
        if (!x.poster_path && !x.backdrop_path) return null;
        const ok = (await resolveVideos(cand)).find((y) => y.status === "ok");
        return ok ? { ...x, video: ok } : null;
      }));
      return { page: r.page, total_pages: Math.min(r.total_pages, 20), results: out.filter(Boolean) };
    }
    case "stream": {
      const t = media.parse(g("type")), i = id.parse(g("id"));
      const n = z.coerce.number().int().min(0).max(500);
      const s = t === "tv" ? n.default(1).parse(g("season")) : undefined;
      const e = t === "tv" ? z.coerce.number().int().min(1).max(5000).default(1).parse(g("episode")) : undefined;
      return { stream: await findStream(t, i, s, e) };
    }
    case "episode-videos": {
      // Each episode's own official clips/previews, so Next/Prev actually changes the video.
      const i = id.parse(g("id")), s = z.coerce.number().int().min(0).max(500).parse(g("season") ?? "1");
      const e = z.coerce.number().int().min(1).max(5000).parse(g("episode") ?? "1");
      const d = await tmdbJson(`tv/${i}/season/${s}/episode/${e}/videos`, { include_video_language: "en,null,tl,es,fr,de,hi,ko,ja,pt" }).catch(() => ({ results: [] }));
      return { videos: (await resolveVideos(d.results ?? [])).filter((v) => v.status === "ok") };
    }
    case "season": {
      const i = id.parse(g("id")), s = z.coerce.number().int().min(0).max(500).parse(g("season") ?? "1");
      // Fail soft: a busy upstream shows an empty season instead of breaking the page.
      const d = await tmdbJson(`tv/${i}/season/${s}`).catch(() => null);
      if (!d) return { episodes: [], degraded: true };
      // Every aired episode is listed, so Next/Prev always moves to a real, different episode.
      const t0 = today();
      const raw: any[] = (d.episodes ?? []).filter((x: any) => !x.air_date || x.air_date <= t0);
      return { episodes: raw.map((x) => ({ n: x.episode_number, name: x.name, date: x.air_date, still: x.still_path, runtime: x.runtime })) };
    }
    case "person": {
      const d = await tmdbJson(`person/${id.parse(g("id"))}`, { append_to_response: "combined_credits,external_ids" });
      const seen = new Set<string>();
      const credits = [...(d.combined_credits?.cast ?? []), ...(d.combined_credits?.crew ?? [])]
        .filter((c: any) => { const k = c.media_type + c.id; if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((x: any, y: any) => (y.popularity ?? 0) - (x.popularity ?? 0)).slice(0, 60)
        .map((c: any) => ({ ...slim(c), credit_role: c.character || c.job || null, credit_dept: c.department ?? "Acting", credit_episodes: c.episode_count ?? null }));
      const playableCredits = await keepPlayable(credits);
      const x = d.external_ids ?? {};
      return { id: d.id, name: d.name, biography: d.biography, profile_path: d.profile_path, birthday: d.birthday, deathday: d.deathday ?? null,
        place_of_birth: d.place_of_birth, known_for: d.known_for_department, aliases: (d.also_known_as ?? []).slice(0, 6), gender: d.gender ?? 0,
        total_credits: seen.size,
        links: { imdb: x.imdb_id ? `https://www.imdb.com/name/${x.imdb_id}` : null, instagram: x.instagram_id ? `https://instagram.com/${x.instagram_id}` : null,
          twitter: x.twitter_id ? `https://x.com/${x.twitter_id}` : null, tiktok: x.tiktok_id ? `https://www.tiktok.com/@${x.tiktok_id}` : null,
          facebook: x.facebook_id ? `https://facebook.com/${x.facebook_id}` : null, homepage: d.homepage || null },
        credits: playableCredits };
    }
    case "collection": {
      const d = await tmdbJson(`collection/${id.parse(g("id"))}`);
      return { id: d.id, name: d.name, overview: d.overview, poster_path: d.poster_path, backdrop_path: d.backdrop_path, parts: (await keepPlayable((d.parts ?? []).map((p: any) => slim(p, "movie")), "movie")).sort((a: any, b: any) => (a.date ?? "").localeCompare(b.date ?? "")) };
    }
    case "calendar": {
      const t = today();
      const [u1, u2, tv] = await Promise.all([tmdbJson("movie/upcoming", { page: 1 }), tmdbJson("movie/upcoming", { page: 2 }), tmdbJson("tv/on_the_air", { page: 1 })]);
      const movies = [...list(u1, "movie").results, ...list(u2, "movie").results].filter((m) => m.date && m.date >= t);
      const uniq = [...new Map(movies.map((m) => [m.id, m])).values()].sort((a, b) => a.date!.localeCompare(b.date!));
      const [mOk, tOk] = await Promise.all([keepPlayable(uniq, "movie"), keepPlayable(list(tv, "tv").results, "tv")]);
      return { today: t, movies: mOk, tv: tOk };
    }
    case "game": {
      const date = today();
      const d = await tmdbJson("trending/movie/day");
      const pool = (d.results ?? []).filter((m: any) => m.poster_path && m.overview && (m.title ?? m.name));
      const h = dayHash(date);
      const answer = pool[h % pool.length];
      const credits = await tmdbJson(`movie/${answer.id}/credits`);
      const others = pool.filter((m: any) => m.id !== answer.id);
      const opts = [answer, ...[0, 1, 2].map((k) => others[(h >>> (k * 5)) % others.length])];
      const uniqueOpts = [...new Map(opts.map((o: any) => [o.id, o])).values()];
      while (uniqueOpts.length < 4 && others.length > 3) { const o = others[uniqueOpts.length * 3 % others.length]; if (!uniqueOpts.includes(o)) uniqueOpts.push(o); else break; }
      const order = uniqueOpts.map((o: any) => ({ o, k: dayHash(date + o.id) })).sort((a, b) => a.k - b.k).map((x) => slim(x.o, "movie"));
      return {
        date, answer_id: answer.id, year: (answer.release_date ?? "").slice(0, 4),
        clues: (credits.cast ?? []).slice(0, 4).map((c: any) => c.name),
        options: order,
      };
    }
    default: throw new z.ZodError([{ code: "custom", message: "Unknown action", path: ["a"] }]);
  }
}

const EDGE_CACHE = {
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
  "CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
  "Cloudflare-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

export const Route = createFileRoute("/api/content")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const rid = request.headers.get("x-request-id") ?? crypto.randomUUID();
        const q = new URL(request.url).searchParams;
        const a = q.get("a") ?? "";
        // Rate-limit check and content load run in parallel (reads are cached and read-only), saving one Redis round trip.
        const work = handleCached(a, q);
        work.catch(() => {});
        // Read path: in-memory sliding-window limit per isolate (no Redis round trip). Redis is reserved for writes.
        const cls = a === "search" ? "s" : a === "title" || a === "person" || a === "reel" ? "m" : "d";
        const lim = cls === "s" ? 60 : cls === "m" ? 90 : 120;
        if (!localRateLimit(`${cls}:${clientIp(request)}`, lim))
          return Response.json({ error: "Too many requests, slow down." }, { status: 429, headers: { "Retry-After": "60", "X-Request-Id": rid } });
        const t0 = Date.now();
        if (aborted(request)) return gone();
        try {
          const data = await work;
          if (aborted(request)) return gone();
          const body = JSON.stringify(data);
          const ms = Date.now() - t0;
          // Structured request log (no secrets, no query values): feeds p50/p95/p99, size and error-rate metrics.
          console.log(JSON.stringify({ rid, route: "content", action: a, status: 200, ms, bytes: body.length }));
          return new Response(body, { headers: { "Content-Type": "application/json", "Server-Timing": `app;dur=${ms}`, ...EDGE_CACHE, "X-Request-Id": rid } });
        } catch (e) {
          // Client navigated away: drop quietly instead of logging a 5xx.
          if (aborted(request) || (e instanceof Error && e.name === "AbortError")) return gone();
          if (e instanceof z.ZodError) return Response.json({ error: "Invalid request" }, { status: 400, headers: { "X-Request-Id": rid } });
          const { log } = await import("@/lib/log.server");
          log("error", "content.failed", { rid, action: a, error: e instanceof Error ? e.message : String(e) });
          const m = /TMDB (\d{3})/.exec(String(e));
          const status = m ? Number(m[1]) : 502;
          return Response.json({ error: status === 404 ? "Not found" : "Content service unavailable" }, { status: status >= 400 ? status : 502, headers: { "X-Request-Id": rid } });
        }
      },
      POST: async ({ request }) => {
        if (!(await rateLimit(`w:${clientIp(request)}`, 60))) return Response.json({ error: "Too many requests" }, { status: 429 });
        try {
          const b = z.object({ a: z.literal("track"), type: media, id, title: z.string().min(1).max(200), poster: z.string().regex(/^\/[A-Za-z0-9_-]{5,64}\.(jpg|png)$/).nullable() }).parse(await request.json());
          const { durable } = await countView(b.type, b.id, b.title, b.poster);
          // Keep search in sync: the title is fetched from TMDB on the server (browser fields are not trusted).
          // Re-index a title at most once per 10 min per instance, so a viral title doesn't flood the search queue.
          if ((b.type === "movie" || b.type === "tv") && onceEvery(`idx:${b.type}:${b.id}`, 600_000)) {
            const { enqueueIndex } = await import("@/lib/algolia.server");
            await enqueueIndex(b.type, b.id).catch(() => {});
          }
          return Response.json({ ok: true, durable });
        } catch (e) {
          if (e instanceof z.ZodError) return Response.json({ error: "Invalid request" }, { status: 400 });
          console.error("track", e);
          return Response.json({ error: "Tracking unavailable" }, { status: 502 });
        }
      },
    },
  },
});
