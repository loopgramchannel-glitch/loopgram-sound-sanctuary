import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { getOriginal } from "@/lib/editorial.functions";
import { StreamPlayer } from "@/components/StreamPlayer";
import { Page } from "@/components/lg";

export const Route = createFileRoute("/original/$id")({
  loader: async ({ params }) => {
    const o = await getOriginal({ data: { id: params.id } });
    if (!o) throw notFound();
    return o;
  },
  head: ({ loaderData }) => {
    const t = loaderData ? `${loaderData.title} — LoopgramChannel Original` : "LoopgramChannel Original";
    const d = loaderData?.overview?.slice(0, 160) || "Watch a LoopgramChannel Original.";
    return { meta: [
      { title: t }, { name: "description", content: d },
      { property: "og:title", content: t }, { property: "og:description", content: d },
      { property: "og:type", content: "video.movie" }, { name: "twitter:card", content: "summary_large_image" },
      ...(loaderData?.poster ? [{ property: "og:image", content: loaderData.poster }, { name: "twitter:image", content: loaderData.poster }] : []),
    ] };
  },
  notFoundComponent: () => <Page><div className="p-8 text-center"><p className="font-semibold">This title isn't available.</p><Link to="/" className="mt-3 inline-block underline">Back home</Link></div></Page>,
  component: OriginalPage,
});

function OriginalPage() {
  const o = Route.useLoaderData();
  const [failed, setFailed] = useState(false);
  const eps = [...(o.episodes ?? [])].filter((e) => e.videoUrl).sort((a, b) => a.season - b.season || a.episode - b.episode);
  const [epIdx, setEpIdx] = useState<number | null>(o.videoUrl ? null : eps.length ? 0 : null);
  const ep = epIdx != null ? eps[epIdx] : undefined;
  const url = ep?.videoUrl ?? o.videoUrl;
  const kind = /\.m3u8(\?|$)/.test(url) ? "hls" : "mp4";
  const facts = [o.year, o.rating, o.runtime ? `${Math.floor(o.runtime / 60) ? `${Math.floor(o.runtime / 60)}h ` : ""}${o.runtime % 60}m` : null, o.genres?.join(", ")].filter(Boolean);
  return (
    <Page>
      <div className="px-4">
        {url && !failed ? <StreamPlayer key={url} url={url} kind={kind} title={ep ? `${o.title} S${ep.season}E${ep.episode}` : o.title} poster={o.backdrop || o.poster || null} onFail={() => setFailed(true)} />
          : <div className="grid aspect-video place-items-center rounded-lg bg-muted text-sm text-muted-foreground">Video coming soon.</div>}
        <h1 className="mt-4 text-2xl font-black">{o.title}</h1>
        {ep && <p className="text-sm font-semibold">S{ep.season} · E{ep.episode}{ep.title ? ` — ${ep.title}` : ""}</p>}
        {facts.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{facts.join(" · ")}</p>}
        {o.tagline && <p className="mt-2 text-sm italic text-muted-foreground">{o.tagline}</p>}
        {(ep?.overview || o.overview) && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{ep?.overview || o.overview}</p>}
        {o.director && <p className="mt-3 text-sm"><span className="text-muted-foreground">{o.kind === "tv" ? "Created by" : "Director"}:</span> {o.director}</p>}
        {o.cast?.length > 0 && <div className="mt-4"><h2 className="text-sm font-bold">Cast</h2>
          <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2">{o.cast.map((c, i) => <li key={i}>{c.name}{c.character && <span className="text-muted-foreground"> as {c.character}</span>}</li>)}</ul></div>}
        {eps.length > 0 && <div className="mt-5"><h2 className="text-sm font-bold">Episodes</h2>
          <ul className="mt-2 divide-y rounded-xl border">{eps.map((e, i) => (
            <li key={`${e.season}-${e.episode}`}><button onClick={() => { setFailed(false); setEpIdx(i); window.scrollTo({ top: 0, behavior: "smooth" }); }} className={`w-full p-3 text-left text-sm hover:bg-accent ${i === epIdx ? "bg-secondary" : ""}`}>
              <span className="font-semibold">S{e.season} E{e.episode}</span>{e.title && ` — ${e.title}`}
            </button></li>
          ))}</ul></div>}
      </div>
    </Page>
  );
}
