import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Bookmark, BookmarkCheck, Star } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { img } from "@/lib/api";
import { imgPriority, useIntentPrefetch } from "@/lib/speed";
import { toggleSave, useStore } from "@/lib/store";

export type Item = { id: number; media_type?: string; title: string; poster_path: string | null; backdrop_path?: string | null; date?: string | null; vote?: number | null; genre_ids?: number[]; overview?: string };

export function itemLink(i: Item) {
  if (i.media_type === "person") return { to: "/person/$id" as const, params: { id: String(i.id) } };
  return { to: "/t/$type/$id" as const, params: { type: i.media_type === "tv" ? "tv" : "movie", id: String(i.id) } };
}

export function Poster({ item, w = "w-32 sm:w-40", eager = false }: { item: Item; w?: string; eager?: boolean }) {
  const src = img(item.poster_path, "w342");
  const qc = useQueryClient();
  const intent = useIntentPrefetch(qc, item.media_type, item.id);
  const [bad, setBad] = useState(false);
  // Strict rule: a title whose picture is missing or fails to load is not shown.
  if (!src || bad) return null;
  return (
    <Link {...itemLink(item)} {...intent} className={`${w} shrink-0 group`} aria-label={item.title}>
      <div className="aspect-[2/3] overflow-hidden rounded-lg bg-muted">
        <img src={src} alt="" width={342} height={513} loading={eager ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} className="h-full w-full bg-black object-contain transition group-hover:scale-105" />
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-tight">{item.title}</p>
      <p className="text-xs text-muted-foreground">{item.date?.slice(0, 4)}{item.vote ? ` · ★ ${item.vote.toFixed(1)}` : ""}</p>
    </Link>
  );
}

export function Row({ title, items, reason }: { title: string; items: Item[]; reason?: string }) {
  if (!items?.length) return null;
  return (
    <section className="py-3">
      <h2 className="px-4 text-lg font-bold">{title}</h2>
      {reason && <p className="px-4 text-xs text-muted-foreground">{reason}</p>}
      <div className="scrollbar-none mt-2 flex gap-3 overflow-x-auto px-4 pb-1">
        {items.map((i, idx) => <Poster key={`${i.media_type}${i.id}`} item={i} eager={idx < 4} />)}
      </div>
    </section>
  );
}

/** YouTube-style feed card (backdrop thumbnail + meta). */
export function FeedCard({ item, index = 99 }: { item: Item; index?: number }) {
  const qc = useQueryClient();
  const intent = useIntentPrefetch(qc, item.media_type, item.id);
  const src = img(item.backdrop_path ?? item.poster_path, "w780");
  const key = `${item.media_type}:${item.id}`;
  const saved = useStore((s) => s.watchlist.some((w) => w.key === key));
  const [bad, setBad] = useState(false);
  if (!src) return null;
  return (
    <article className="group">
      <Link {...itemLink(item)} {...intent} className="block">
        <div className="aspect-video overflow-hidden rounded-xl bg-muted flex items-center justify-center">
          {bad ? <span className="px-4 text-center text-sm font-medium text-muted-foreground line-clamp-2">{item.title}</span>
            : <img src={src} alt="" width={780} height={439} {...imgPriority(index)} decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} className="h-full w-full bg-black object-contain transition group-hover:scale-[1.02]" />}
        </div>
      </Link>
      <div className="mt-2 flex gap-3">
        <div className="min-w-0 flex-1">
          <Link {...itemLink(item)} className="line-clamp-2 font-semibold leading-snug">{item.title}</Link>
          <p className="text-sm text-muted-foreground">
            {item.media_type === "tv" ? "TV" : "Movie"} · {item.date?.slice(0, 4) ?? "TBA"}
            {item.vote ? <> · <Star className="inline h-3 w-3" aria-hidden /> {item.vote.toFixed(1)}</> : null}
          </p>
        </div>
        {item.media_type !== "person" && (
          <button aria-label={saved ? "Remove from watchlist" : "Save to watchlist"} className="h-9 w-9 shrink-0 rounded-full hover:bg-accent flex items-center justify-center"
            onClick={() => toggleSave({ id: item.id, type: item.media_type === "tv" ? "tv" : "movie", title: item.title, poster: item.poster_path, date: item.date ?? null, genre_ids: item.genre_ids ?? [] })}>
            {saved ? <BookmarkCheck className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />}
          </button>
        )}
      </div>
    </article>
  );
}

export function Grid({ items }: { items: Item[] }) {
  return <div className="grid grid-cols-3 gap-3 px-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">{items.map((i) => <Poster key={`${i.media_type}${i.id}`} item={i} w="w-full" />)}</div>;
}

export function Skel({ n = 6 }: { n?: number }) {
  return <div className="grid grid-cols-1 gap-6 px-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: n }).map((_, i) => <div key={i} className="aspect-video animate-pulse rounded-xl bg-muted" />)}</div>;
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="m-4 rounded-xl border p-4 text-sm">
      <p>{error instanceof Error ? error.message : "Something went wrong."}</p>
      {retry && <button onClick={retry} className="mt-2 rounded-full bg-primary px-4 py-1.5 text-primary-foreground">Retry</button>}
    </div>
  );
}

export function Page({ title, children }: { title?: string; children: React.ReactNode }) {
  return <div className="mx-auto max-w-7xl pb-24 pt-2">{title && <h1 className="px-4 py-3 text-2xl font-bold">{title}</h1>}{children}</div>;
}
