import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Plus, Search, Star, Trophy, X } from "lucide-react";
import { api, img } from "@/lib/api";
import { Page, type Item } from "@/components/lg";

const ref = z.string().regex(/^(movie|tv):\d+$/).optional().catch(undefined);
export const Route = createFileRoute("/compare")({
  validateSearch: z.object({ a: ref, b: ref }),
  head: () => ({
    meta: [
      { title: "Compare — LoopgramChannel" },
      { name: "description", content: "Compare two movies or TV shows side by side." },
      { property: "og:title", content: "Compare — LoopgramChannel" },
      { property: "og:description", content: "Side-by-side title comparison." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Compare,
});

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

function PickerSheet({ onPick, onClose }: { onPick: (r: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const res = useQuery({ queryKey: ["search", "pick", dq], queryFn: ({ signal }) => api<{ results: Item[] }>({ a: "search", q: dq }, signal), enabled: dq.length > 1, staleTime: 15 * 60_000 });
  const list = res.data?.results.filter((r) => r.media_type !== "person" && r.poster_path).slice(0, 12) ?? [];
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 backdrop-blur-sm sm:items-start sm:pt-24" onClick={onClose} role="dialog" aria-modal="true" aria-label="Pick a title">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl border bg-card shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b p-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search movies or TV shows" aria-label="Search a title to compare" className="h-9 flex-1 bg-transparent text-sm outline-none" />
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <ul className="flex-1 overflow-auto p-2">
          {dq.length < 2 && <li className="p-6 text-center text-sm text-muted-foreground">Type at least 2 letters to search</li>}
          {dq.length > 1 && res.isPending && Array.from({ length: 4 }).map((_, i) => <li key={i} className="m-1 h-16 animate-pulse rounded-lg bg-muted" />)}
          {dq.length > 1 && res.isSuccess && !list.length && <li className="p-6 text-center text-sm text-muted-foreground">No titles found</li>}
          {list.map((r) => (
            <li key={`${r.media_type}${r.id}`}>
              <button className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-accent" onClick={() => onPick(`${r.media_type ?? "movie"}:${r.id}`)}>
                <img src={img(r.poster_path, "w92") ?? ""} alt="" className="h-14 w-10 shrink-0 rounded bg-muted object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.title}</span>
                  <span className="text-xs text-muted-foreground">{r.date?.slice(0, 4) ?? "—"}{r.vote ? ` · ★ ${r.vote.toFixed(1)}` : ""}</span>
                </span>
                <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{r.media_type === "tv" ? "TV" : "Movie"}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function useTitle(r?: string) {
  const [type, id] = r?.split(":") ?? [];
  return useQuery({ queryKey: ["title", type, id], queryFn: () => api<any>({ a: "title", type, id }), enabled: !!r, staleTime: 30 * 60_000 });
}

const money = (n?: number | null) => (n ? (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(0)}M`) : "—");
const names = (arr: any[] = [], n = 4) => arr.slice(0, n).map((c) => c.name).join(", ") || "—";

type Stat = { label: string; get: (d: any) => number | null | undefined; fmt: (v: any, d: any) => string };
const STATS: Stat[] = [
  { label: "Rating", get: (d) => d.vote || null, fmt: (v, d) => (v ? `★ ${v.toFixed(1)}` + (d.votes ? ` · ${Intl.NumberFormat("en", { notation: "compact" }).format(d.votes)}` : "") : "—") },
  { label: "Runtime", get: (d) => d.runtime || null, fmt: (v) => (v ? `${Math.floor(v / 60)}h ${v % 60}m` : "—") },
  { label: "Budget", get: (d) => d.budget || null, fmt: (v) => money(v) },
  { label: "Box office", get: (d) => d.revenue || null, fmt: (v) => money(v) },
];

function Slot({ r, q, onOpen, onClear }: { r: string | undefined; q: ReturnType<typeof useTitle>; onOpen: () => void; onClear: () => void }) {
  if (r && q.isPending) return <div className="aspect-[2/3] w-full animate-pulse rounded-xl bg-muted" />;
  if (r && q.data) {
    const d = q.data;
    const parts = r.split(":");
    const type: string = parts[0] ?? "movie", id: string = parts[1] ?? "";
    return (
      <div className="flex flex-col">
        <Link to="/t/$type/$id" params={{ type, id }} className="block overflow-hidden rounded-xl border bg-muted shadow-lg">
          <img src={img(d.poster_path, "w342") ?? ""} alt={d.title} className="aspect-[2/3] w-full object-cover" />
        </Link>
        <p className="mt-2 line-clamp-2 text-sm font-semibold leading-tight">{d.title}</p>
        <p className="text-xs text-muted-foreground">{d.date?.slice(0, 4) ?? "—"} · {type === "tv" ? "TV" : "Movie"}</p>
        <div className="mt-1.5 flex gap-3 text-xs">
          <button onClick={onOpen} className="font-medium text-primary hover:underline">Change</button>
          <button onClick={onClear} className="text-muted-foreground hover:underline">Remove</button>
        </div>
      </div>
    );
  }
  return (
    <button onClick={onOpen} className="flex aspect-[2/3] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-muted-foreground transition hover:border-primary hover:text-primary">
      <span className="rounded-full bg-muted p-3"><Plus className="h-5 w-5" /></span>
      <span className="text-sm font-medium">Add title</span>
    </button>
  );
}

function Compare() {
  const { a, b } = Route.useSearch();
  const nav = useNavigate();
  const A = useTitle(a), B = useTitle(b);
  const [open, setOpen] = useState<"a" | "b" | null>(null);
  const set = (k: "a" | "b", v?: string) => nav({ to: "/compare", search: (s: any) => ({ ...s, [k]: v }), replace: true });
  const both = A.data && B.data;

  const details: [string, (d: any) => string][] = [
    ["Genres", (d) => d.genres?.map((g: any) => g.name).join(", ") || "—"],
    ["Director / Creator", (d) => names([...(d.creators ?? []), ...(d.crew ?? []).filter((c: any) => c.job === "Director")], 3)],
    ["Top cast", (d) => names(d.cast, 4)],
    ["Status", (d) => d.status ?? "—"],
  ];

  let winsA = 0, winsB = 0;
  if (both) for (const s of STATS.slice(0, 1).concat(STATS.slice(3))) { const x = s.get(A.data) ?? 0, y = s.get(B.data) ?? 0; if (x > y) winsA++; else if (y > x) winsB++; }

  return (
    <Page title="Compare">
      <div className="mx-auto w-full max-w-3xl px-4 pb-10">
        <p className="mb-4 text-sm text-muted-foreground">Pick two movies or shows to see how they stack up.</p>

        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3 sm:gap-6">
          <Slot r={a} q={A} onOpen={() => setOpen("a")} onClear={() => set("a")} />
          <div className="mt-[40%] flex h-10 w-10 items-center justify-center rounded-full bg-primary text-xs font-black text-primary-foreground shadow-lg sm:h-12 sm:w-12 sm:text-sm">VS</div>
          <Slot r={b} q={B} onOpen={() => setOpen("b")} onClear={() => set("b")} />
        </div>

        {both && (
          <>
            {(winsA || winsB) && winsA !== winsB ? (
              <div className="mt-6 flex items-center gap-2 rounded-xl border bg-card p-3 text-sm">
                <Trophy className="h-4 w-4 shrink-0 text-primary" />
                <span><b>{winsA > winsB ? A.data.title : B.data.title}</b> leads on rating and box office.</span>
              </div>
            ) : null}

            <section className="mt-6">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Key numbers</h2>
              <div className="overflow-hidden rounded-xl border bg-card">
                {STATS.map((s) => {
                  const x = s.get(A.data), y = s.get(B.data);
                  const wa = x != null && (y == null || x > y), wb = y != null && (x == null || y > x);
                  return (
                    <div key={s.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b px-3 py-3 last:border-b-0">
                      <span className={`text-sm ${wa ? "font-semibold text-primary" : ""}`}>{s.fmt(x, A.data)}</span>
                      <span className="w-20 text-center text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</span>
                      <span className={`text-right text-sm ${wb ? "font-semibold text-primary" : ""}`}>{s.fmt(y, B.data)}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="mt-6">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Details</h2>
              <div className="space-y-3">
                {details.map(([label, f]) => (
                  <div key={label} className="rounded-xl border bg-card p-3">
                    <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <p className="leading-snug">{f(A.data)}</p>
                      <p className="border-l pl-3 leading-snug">{f(B.data)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {(A.data.overview || B.data.overview) && (
              <section className="mt-6">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Story</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[A.data, B.data].map((d, i) => (
                    <div key={i} className="rounded-xl border bg-card p-3">
                      <p className="mb-1 text-sm font-semibold">{d.title}</p>
                      <p className="line-clamp-5 text-sm text-muted-foreground">{d.overview || "—"}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {!both && (a || b) && !(A.isPending && a) && !(B.isPending && b) && (
          <p className="mt-6 flex items-center justify-center gap-1 text-center text-sm text-muted-foreground"><Star className="h-4 w-4" /> Add one more title to see the comparison.</p>
        )}
      </div>

      {open && <PickerSheet onClose={() => setOpen(null)} onPick={(v) => { set(open, v); setOpen(null); }} />}
    </Page>
  );
}
