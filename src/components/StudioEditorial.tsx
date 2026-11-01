// Studio panels for the six editorial modules. All writes go through owner-only server functions.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, EyeOff, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { studioAnalytics, studioEditorial, studioEditorialSave, studioTitleSearch } from "@/lib/editorial.functions";
import { GENRES, Original, itemKey, resolveShelves, slug, type EditorialT, type EdItemT, type EpisodeT, type OriginalT } from "@/lib/editorial";
import { Uploader } from "@/components/Uploader";

const err = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^\d{3}:\s*/, "");
const img = (p: string | null) => (p ? `https://image.tmdb.org/t/p/w92${p}` : null);
const btn = "inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-xs hover:bg-accent disabled:opacity-50";
const primary = "inline-flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50";
const input = "h-10 w-full rounded-lg border bg-background px-3 text-sm";

function useCall() {
  const { getToken } = useAuth();
  return async <T,>(fn: (a: { data: any }) => Promise<T>, extra: Record<string, unknown> = {}) => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    return fn({ data: { token, ...extra } });
  };
}

function useEditorial() {
  const call = useCall();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["studio", "editorial"], queryFn: () => call(studioEditorial) });
  const save = useMutation({
    mutationFn: (v: { editorial: EditorialT; what: string }) => call(studioEditorialSave, v),
    onSuccess: (_r, v) => { qc.setQueryData(["studio", "editorial"], v.editorial); qc.invalidateQueries({ queryKey: ["editorial"] }); toast.success("Saved — live on the site within a few seconds"); },
    onError: (e) => toast.error(err(e)),
  });
  return { q, save, ed: q.data, put: (editorial: EditorialT, what: string) => save.mutate({ editorial, what }) };
}

const Loading = () => <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-secondary" />)}</div>;
const Fail = ({ e, retry }: { e: unknown; retry: () => void }) => <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{err(e)} <button onClick={retry} className="ml-2 underline">Retry</button></div>;
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;

function Thumb({ i }: { i: { title: string; poster_path: string | null } }) {
  const s = img(i.poster_path);
  return s ? <img src={s} alt="" className="h-12 w-8 shrink-0 rounded object-cover" loading="lazy" /> : <div className="h-12 w-8 shrink-0 rounded bg-secondary" />;
}

/** TMDB title search with per-result action buttons. */
function TitleSearch({ actions }: { actions: (i: EdItemT & { stream: string | null; date: string | null }) => React.ReactNode }) {
  const call = useCall();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const r = useQuery({ queryKey: ["studio", "tsearch", q], queryFn: () => call(studioTitleSearch, { q }), enabled: q.length > 0 });
  return (
    <div className="space-y-2">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setQ(text.trim()); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search movies and TV" aria-label="Search titles" className={input} />
        <button className={primary + " h-10"}>Search</button>
      </form>
      {r.isFetching && <Loading />}
      {r.isError && <Fail e={r.error} retry={() => r.refetch()} />}
      {r.data && !r.isFetching && (r.data.items.length === 0 ? <Empty>No titles found.</Empty> : (
        <ul className="divide-y rounded-xl border">{r.data.items.map((i) => (
          <li key={itemKey(i)} className="flex items-center gap-3 p-2">
            <Thumb i={i} />
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{i.title}</div>
              <div className="text-xs text-muted-foreground">{i.media_type === "tv" ? "TV" : "Movie"} · {i.date?.slice(0, 4) ?? "—"} · {i.stream ? <span className="text-primary">Full video in your bucket ({i.stream})</span> : "Trailer only"}</div></div>
            <div className="flex shrink-0 gap-1">{actions(i)}</div>
          </li>
        ))}</ul>
      ))}
    </div>
  );
}

function ItemList({ items, onRemove, empty }: { items: EdItemT[]; onRemove: (i: EdItemT) => void; empty: string }) {
  if (!items.length) return <Empty>{empty}</Empty>;
  return <ul className="divide-y rounded-xl border">{items.map((i) => (
    <li key={itemKey(i)} className="flex items-center gap-3 p-2"><Thumb i={i} /><span className="min-w-0 flex-1 truncate text-sm">{i.title} <span className="text-xs text-muted-foreground">· {i.media_type === "tv" ? "TV" : "Movie"}</span></span>
      <button className={btn} onClick={() => onRemove(i)} aria-label={`Remove ${i.title}`}><Trash2 className="h-3.5 w-3.5" />Remove</button></li>
  ))}</ul>;
}

const strip = (i: EdItemT): EdItemT => ({ id: i.id, media_type: i.media_type, title: i.title, poster_path: i.poster_path });
const has = (list: EdItemT[], i: EdItemT) => list.some((x) => itemKey(x) === itemKey(i));

// ---------- 1. Content Library (LoopgramChannel Originals) ----------
export function ContentLibraryPanel() {
  const { q, ed, put, save } = useEditorial();
  const [edit, setEdit] = useState<OriginalT | null>(null);
  if (q.isPending) return <Loading />;
  if (q.isError || !ed) return <Fail e={q.error} retry={() => q.refetch()} />;
  const blank: OriginalT = { ...Original.parse({ id: "new-title", title: "x", year: null }), id: "", title: "" };
  const submit = (o: OriginalT) => {
    const isNew = !o.id;
    const item = { ...o, id: o.id || slug(o.title) };
    const originals = isNew ? [item, ...ed.originals] : ed.originals.map((x) => (x.id === item.id ? item : x));
    put({ ...ed, originals }, isNew ? "original.create" : "original.update");
    setEdit(null);
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Your own titles, separate from the TMDB catalog. Published ones appear in the "LoopgramChannel Originals" shelf and play from your media bucket.</p>
      <button className={primary} onClick={() => setEdit(blank)}><Plus className="h-4 w-4" />New title</button>
      {edit && <OriginalForm value={edit} busy={save.isPending} onCancel={() => setEdit(null)} onSave={submit} />}
      {ed.originals.length === 0 ? <Empty>No titles yet. Create your first one above.</Empty> : (
        <ul className="divide-y rounded-xl border">{ed.originals.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-3 p-3">
            {o.poster ? <img src={o.poster} alt="" className="h-12 w-8 rounded object-cover" /> : <div className="h-12 w-8 rounded bg-secondary" />}
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{o.title} {o.year && <span className="text-muted-foreground">({o.year})</span>}</div>
              <div className="text-xs text-muted-foreground">{o.published ? <span className="text-primary">Published</span> : "Draft"} · {o.videoUrl ? "Video attached" : "No video"}</div></div>
            <button className={btn} onClick={() => put({ ...ed, originals: ed.originals.map((x) => (x.id === o.id ? { ...x, published: !x.published } : x)) }, o.published ? "original.unpublish" : "original.publish")}>{o.published ? "Unpublish" : "Publish"}</button>
            <button className={btn} onClick={() => setEdit(o)}>Edit</button>
            <button className={btn} onClick={() => { if (confirm(`Delete "${o.title}"? This can't be undone.`)) put({ ...ed, originals: ed.originals.filter((x) => x.id !== o.id) }, "original.delete"); }}><Trash2 className="h-3.5 w-3.5" /></button>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

function OriginalForm({ value, onSave, onCancel, busy }: { value: OriginalT; onSave: (o: OriginalT) => void; onCancel: () => void; busy: boolean }) {
  const [v, setV] = useState(value);
  const [tab, setTab] = useState<"info" | "media" | "cast" | "episodes">("info");
  const set = <K extends keyof OriginalT>(k: K, x: OriginalT[K]) => setV((o) => ({ ...o, [k]: x }));
  const num = (s: string) => (s ? Number(s) : null);
  const tabs = [["info", "General info"], ["media", "Video & pictures"], ["cast", "Cast & crew"], ...(v.kind === "tv" ? [["episodes", `Episodes (${v.episodes.length})`]] : [])] as const;
  const setEp = (i: number, patch: Partial<EpisodeT>) => set("episodes", v.episodes.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  return (
    <form className="space-y-4 rounded-xl border bg-card p-4" onSubmit={(e) => { e.preventDefault(); if (!v.title.trim()) { toast.error("Title is required"); setTab("info"); return; } onSave(v); }}>
      <div role="tablist" className="scrollbar-none flex gap-1 overflow-x-auto">
        {tabs.map(([id, l]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id as typeof tab)} className={`h-9 shrink-0 rounded-lg px-3 text-xs ${tab === id ? "bg-primary text-primary-foreground" : "border"}`}>{l}</button>)}
      </div>

      {tab === "info" && <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">Title<input className={input} required maxLength={200} value={v.title} onChange={(e) => set("title", e.target.value)} /></label>
        <label className="text-xs">Type<select className={input} value={v.kind} onChange={(e) => set("kind", e.target.value as OriginalT["kind"])}><option value="movie">Movie</option><option value="tv">TV show</option></select></label>
        <label className="text-xs sm:col-span-2">Tagline<input className={input} maxLength={200} value={v.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="Some secrets cannot be buried." /></label>
        <label className="text-xs">Release date<input className={input} type="date" value={v.releaseDate} onChange={(e) => { set("releaseDate", e.target.value); if (e.target.value) set("year", Number(e.target.value.slice(0, 4))); }} /></label>
        <label className="text-xs">Year<input className={input} type="number" min={1888} max={2100} value={v.year ?? ""} onChange={(e) => set("year", num(e.target.value))} /></label>
        <label className="text-xs">Runtime (minutes)<input className={input} type="number" min={1} max={1000} value={v.runtime ?? ""} onChange={(e) => set("runtime", num(e.target.value))} /></label>
        <label className="text-xs">Age rating<input className={input} maxLength={20} value={v.rating} onChange={(e) => set("rating", e.target.value)} placeholder="PG-13" /></label>
        <div className="text-xs sm:col-span-2">Genres
          <div className="mt-1 flex flex-wrap gap-1.5">{GENRES.map((g) => { const on = v.genres.includes(g); return (
            <button key={g} type="button" aria-pressed={on} onClick={() => set("genres", on ? v.genres.filter((x) => x !== g) : [...v.genres, g].slice(0, 10))} className={`rounded-full px-3 py-1 text-xs ${on ? "bg-primary text-primary-foreground" : "border"}`}>{g}</button>); })}</div>
        </div>
        <label className="text-xs sm:col-span-2">Overview<textarea className={input + " h-24 py-2"} maxLength={2000} value={v.overview} onChange={(e) => set("overview", e.target.value)} /></label>
      </div>}

      {tab === "media" && <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2 text-xs">{v.kind === "tv" ? "Trailer or main video (optional)" : "Full video"}
          {v.videoUrl && <div className="truncate text-muted-foreground">Attached: {v.videoUrl.split("/").pop()} <button type="button" className="ml-1 underline" onClick={() => set("videoUrl", "")}>Remove</button></div>}
          <Uploader compact target={{ kind: "original-video" }} label={v.videoUrl ? "Replace video" : "Upload video"} onDone={(r) => set("videoUrl", r.publicUrl)} />
        </div>
        <div className="space-y-2 text-xs">Poster (tall, 2:3)
          {v.poster && <img src={v.poster} alt="" className="h-28 w-[4.7rem] rounded object-cover" />}
          <Uploader compact target={{ kind: "image" }} label={v.poster ? "Replace poster" : "Upload poster"} onDone={(r) => set("poster", r.publicUrl)} />
        </div>
        <div className="space-y-2 text-xs">Banner (wide, 16:9)
          {v.backdrop && <img src={v.backdrop} alt="" className="aspect-video h-28 rounded object-cover" />}
          <Uploader compact target={{ kind: "image" }} label={v.backdrop ? "Replace banner" : "Upload banner"} onDone={(r) => set("backdrop", r.publicUrl)} />
        </div>
      </div>}

      {tab === "cast" && <div className="space-y-3">
        <label className="block text-xs">Director / creator<input className={input} maxLength={200} value={v.director} onChange={(e) => set("director", e.target.value)} /></label>
        {v.cast.map((c, i) => (
          <div key={i} className="flex gap-2">
            <input className={input} aria-label="Actor name" placeholder="Actor" value={c.name} onChange={(e) => set("cast", v.cast.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
            <input className={input} aria-label="Character" placeholder="Character" value={c.character} onChange={(e) => set("cast", v.cast.map((x, k) => (k === i ? { ...x, character: e.target.value } : x)))} />
            <button type="button" className={btn} aria-label="Remove actor" onClick={() => set("cast", v.cast.filter((_, k) => k !== i))}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        <button type="button" className={btn} disabled={v.cast.length >= 30} onClick={() => set("cast", [...v.cast, { name: "", character: "" }])}><Plus className="h-3.5 w-3.5" />Add actor</button>
      </div>}

      {tab === "episodes" && <div className="space-y-3">
        {v.episodes.map((e, i) => (
          <div key={i} className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="w-20 text-xs">Season<input className={input} type="number" min={0} value={e.season} onChange={(x) => setEp(i, { season: Number(x.target.value) || 0 })} /></label>
              <label className="w-20 text-xs">Episode<input className={input} type="number" min={1} value={e.episode} onChange={(x) => setEp(i, { episode: Number(x.target.value) || 1 })} /></label>
              <label className="min-w-40 flex-1 text-xs">Episode title<input className={input} maxLength={200} value={e.title} onChange={(x) => setEp(i, { title: x.target.value })} /></label>
              <button type="button" className={btn} aria-label="Remove episode" onClick={() => set("episodes", v.episodes.filter((_, k) => k !== i))}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <textarea className={input + " h-16 py-2"} aria-label="Episode overview" placeholder="What happens in this episode" maxLength={2000} value={e.overview} onChange={(x) => setEp(i, { overview: x.target.value })} />
            {e.videoUrl && <div className="truncate text-xs text-muted-foreground">Video: {e.videoUrl.split("/").pop()}</div>}
            <Uploader compact target={{ kind: "original-video" }} label={e.videoUrl ? "Replace episode video" : "Upload episode video"} onDone={(r) => setEp(i, { videoUrl: r.publicUrl })} />
          </div>
        ))}
        <button type="button" className={btn} disabled={v.episodes.length >= 500} onClick={() => { const last = v.episodes[v.episodes.length - 1]; set("episodes", [...v.episodes, { season: last?.season ?? 1, episode: (last?.episode ?? 0) + 1, title: "", overview: "", videoUrl: "" }]); }}><Plus className="h-3.5 w-3.5" />Add episode</button>
      </div>}

      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.published} onChange={(e) => set("published", e.target.checked)} />Published (visible to visitors)</label>
      <p className="text-xs text-muted-foreground">Uploads are saved to your bucket right away; press Save to attach them to this title.</p>
      <div className="flex justify-end gap-2"><button type="button" className={btn} onClick={onCancel}>Cancel</button><button className={primary} disabled={busy}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save</button></div>
    </form>
  );
}

// ---------- 2. Movies and TV ----------
export function TitlesPanel() {
  const { q, ed, put } = useEditorial();
  if (q.isPending) return <Loading />;
  if (q.isError || !ed) return <Fail e={q.error} retry={() => q.refetch()} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Look up any movie or show, see whether a full-length file is in your bucket, feature it on the homepage, or hide it from visitors. Full videos are matched by file name (media/movie/&lt;id&gt;.mp4) in Media Library.</p>
      <TitleSearch actions={(i) => (<>
        <button className={btn} disabled={has(ed.featured, i)} onClick={() => put({ ...ed, featured: [strip(i), ...ed.featured].slice(0, 40) }, "featured.add")}><Star className="h-3.5 w-3.5" />{has(ed.featured, i) ? "Featured" : "Feature"}</button>
        <button className={btn} disabled={has(ed.hidden, i)} onClick={() => put({ ...ed, hidden: [strip(i), ...ed.hidden] }, "title.hide")}><EyeOff className="h-3.5 w-3.5" />{has(ed.hidden, i) ? "Hidden" : "Hide"}</button>
      </>)} />
      <h2 className="pt-2 text-sm font-semibold">Featured on homepage ({ed.featured.length})</h2>
      <ItemList items={ed.featured} empty="Nothing featured yet." onRemove={(i) => put({ ...ed, featured: ed.featured.filter((x) => itemKey(x) !== itemKey(i)) }, "featured.remove")} />
    </div>
  );
}

// ---------- 3. Categories & Collections ----------
export function CollectionsPanel() {
  const { q, ed, put } = useEditorial();
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  if (q.isPending) return <Loading />;
  if (q.isError || !ed) return <Fail e={q.error} retry={() => q.refetch()} />;
  const col = ed.collections.find((c) => c.id === open);
  const upd = (id: string, items: EdItemT[], what: string) => put({ ...ed, collections: ed.collections.map((c) => (c.id === id ? { ...c, items } : c)) }, what);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Build your own shelves (e.g. "Weekend picks"). Each one appears on the homepage; turn it on/off or reorder it in Homepage Manager.</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (!n) return; const id = slug(n); put({ ...ed, collections: [...ed.collections, { id, name: n, items: [] }] }, "collection.create"); setName(""); setOpen(id); }}>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="New collection name" aria-label="New collection name" />
        <button className={primary + " h-10"} disabled={ed.collections.length >= 30}><Plus className="h-4 w-4" />Create</button>
      </form>
      {ed.collections.length === 0 ? <Empty>No collections yet.</Empty> : (
        <div className="flex flex-wrap gap-2">{ed.collections.map((c) => (
          <button key={c.id} onClick={() => setOpen(c.id)} className={`rounded-lg border px-3 py-1.5 text-sm ${open === c.id ? "bg-accent font-semibold" : ""}`}>{c.name} <span className="text-muted-foreground">({c.items.length})</span></button>
        ))}</div>
      )}
      {col && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2"><h2 className="flex-1 font-semibold">{col.name}</h2>
            <button className={btn} onClick={() => { const n = prompt("Rename collection", col.name)?.trim(); if (n) put({ ...ed, collections: ed.collections.map((c) => (c.id === col.id ? { ...c, name: n.slice(0, 80) } : c)) }, "collection.rename"); }}>Rename</button>
            <button className={btn} onClick={() => { if (confirm(`Delete "${col.name}"?`)) { put({ ...ed, collections: ed.collections.filter((c) => c.id !== col.id) }, "collection.delete"); setOpen(null); } }}><Trash2 className="h-3.5 w-3.5" />Delete</button></div>
          <TitleSearch actions={(i) => <button className={btn} disabled={has(col.items, i) || col.items.length >= 40} onClick={() => upd(col.id, [...col.items, strip(i)], "collection.add")}><Plus className="h-3.5 w-3.5" />{has(col.items, i) ? "Added" : "Add"}</button>} />
          <ItemList items={col.items} empty="No titles in this collection yet." onRemove={(i) => upd(col.id, col.items.filter((x) => itemKey(x) !== itemKey(i)), "collection.remove")} />
        </div>
      )}
    </div>
  );
}

// ---------- 4. Homepage Manager ----------
export function HomepagePanel() {
  const { q, ed, put, save } = useEditorial();
  const [draft, setDraft] = useState<ReturnType<typeof resolveShelves> | null>(null);
  if (q.isPending) return <Loading />;
  if (q.isError || !ed) return <Fail e={q.error} retry={() => q.refetch()} />;
  const list = draft ?? resolveShelves(ed);
  const move = (i: number, d: number) => { const n = [...list]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j]!, n[i]!]; setDraft(n); };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Choose which shelves visitors see on the homepage and in what order. Empty shelves are skipped automatically. "Recommended for you" and the trending feed always stay.</p>
      <ul className="divide-y rounded-xl border">{list.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2 p-2">
          <input type="checkbox" aria-label={`Show ${s.title}`} checked={s.on} onChange={(e) => setDraft(list.map((x) => (x.key === s.key ? { ...x, on: e.target.checked } : x)))} />
          {s.key.startsWith("col:") ? <span className="flex-1 text-sm">{s.title} <span className="text-xs text-muted-foreground">· your collection</span></span>
            : <input className="h-9 flex-1 rounded-lg border bg-background px-2 text-sm" maxLength={80} value={s.title} aria-label="Shelf title" onChange={(e) => setDraft(list.map((x) => (x.key === s.key ? { ...x, title: e.target.value } : x)))} />}
          <button className={btn} onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
          <button className={btn} onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
        </li>
      ))}</ul>
      <div className="flex gap-2"><button className={primary} disabled={!draft || save.isPending} onClick={() => { put({ ...ed, shelves: list }, "homepage.update"); setDraft(null); }}>Save layout</button>
        {draft && <button className={btn} onClick={() => setDraft(null)}>Discard changes</button>}</div>
    </div>
  );
}

// ---------- 5. Moderation ----------
export function ModerationPanel() {
  const { q, ed, put } = useEditorial();
  if (q.isPending) return <Loading />;
  if (q.isError || !ed) return <Fail e={q.error} retry={() => q.refetch()} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Hide titles you don't want on LoopgramChannel — they're removed from homepage shelves and the trending feed. To block a person, use User Management (disable account / sign out everywhere).</p>
      <TitleSearch actions={(i) => <button className={btn} disabled={has(ed.hidden, i)} onClick={() => put({ ...ed, hidden: [strip(i), ...ed.hidden] }, "title.hide")}><EyeOff className="h-3.5 w-3.5" />{has(ed.hidden, i) ? "Hidden" : "Hide"}</button>} />
      <h2 className="pt-2 text-sm font-semibold">Hidden titles ({ed.hidden.length})</h2>
      <ItemList items={ed.hidden} empty="No hidden titles." onRemove={(i) => put({ ...ed, hidden: ed.hidden.filter((x) => itemKey(x) !== itemKey(i)) }, "title.unhide")} />
    </div>
  );
}

// ---------- 6. Analytics ----------
export function AnalyticsPanel() {
  const call = useCall();
  const q = useQuery({ queryKey: ["studio", "analytics"], queryFn: () => call(studioAnalytics), staleTime: 30_000 });
  if (q.isPending) return <Loading />;
  if (q.isError) return <Fail e={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const na = <span className="text-base font-medium text-muted-foreground">Unavailable</span>;
  const max = Math.max(1, ...(d.top ?? []).map((r) => r.views));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[["Views (top 25 titles)", d.totalViews], ["Titles with views", d.titles], ["Registered accounts", d.accounts], ["Owner actions logged", d.auditLen]].map(([l, v]) => (
          <div key={l as string} className="rounded-xl border bg-card p-4"><div className="text-xs text-muted-foreground">{l}</div><div className="mt-1 text-2xl font-black">{v ?? na}</div></div>
        ))}
      </div>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Most watched on LoopgramChannel (all time)</h2>
        {!d.top ? <p className="text-sm text-muted-foreground">View counts are unavailable right now.</p> : d.top.length === 0 ? <p className="text-sm text-muted-foreground">No views recorded yet.</p> : (
          <ol className="space-y-1.5">{d.top.map((r, i) => (
            <li key={r.key} className="text-sm"><div className="flex justify-between gap-2"><span className="truncate">{i + 1}. {r.title}</span><span className="font-mono text-xs">{r.views.toLocaleString()}</span></div>
              <div className="mt-0.5 h-1.5 rounded bg-secondary"><div className="h-full rounded bg-primary" style={{ width: `${(r.views / max) * 100}%` }} /></div></li>
          ))}</ol>
        )}
      </section>
    </div>
  );
}
