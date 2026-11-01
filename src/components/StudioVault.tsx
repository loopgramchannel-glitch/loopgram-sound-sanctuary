// Studio "Saved Library": every title stored in the permanent movie database, regardless of trending rank.
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { studioExportVault, studioVault } from "@/lib/studio.functions";

const err = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^\d{3}:\s*/, "");
const chip = (on: boolean) => `h-9 shrink-0 rounded-lg px-3 text-xs ${on ? "bg-primary text-primary-foreground" : "border"}`;

export function VaultPanel() {
  const { getToken } = useAuth();
  const [view, setView] = useState<"saved" | "quarantined">("saved");
  const [type, setType] = useState<"all" | "movie" | "tv">("all");
  const [text, setText] = useState("");
  const q = useInfiniteQuery({
    queryKey: ["studio", "vault", view, type],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      return studioVault({ data: { token, view, type, cursor: pageParam } });
    },
    getNextPageParam: (p) => p.cursor,
  });
  const [exp, setExp] = useState<{ scope: "titles" | "all"; count: number } | null>(null);
  const [file, setFile] = useState<{ blob: Blob; name: string; count: number } | null>(null);
  const [expErr, setExpErr] = useState<string | null>(null);
  async function runExport(scope: "titles" | "all") {
    setFile(null); setExpErr(null); setExp({ scope, count: 0 });
    try {
      const records: unknown[] = [];
      let cursor: string | null = null;
      do {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const r: { records: string; cursor: string | null } = await studioExportVault({ data: { token, scope, cursor } });
        records.push(...(JSON.parse(r.records) as unknown[])); cursor = r.cursor;
        setExp({ scope, count: records.length });
      } while (cursor);
      const day = new Date().toISOString().slice(0, 10);
      const json = JSON.stringify({ exportedAt: new Date().toISOString(), scope, count: records.length, records }, null, 2);
      setFile({ blob: new Blob([json], { type: "application/json" }), name: `loopgram-${scope === "all" ? "full-database" : "saved-titles"}-${day}.json`, count: records.length });
    } catch (e) { setExpErr(err(e)); }
    finally { setExp(null); }
  }
  function save() {
    if (!file) return;
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement("a"); a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  const seen = new Set<string>();
  const all = (q.data?.pages ?? []).flatMap((p) => p.items).filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
  const t = text.trim().toLowerCase();
  const list = t ? all.filter((i) => i.title.toLowerCase().includes(t)) : all;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Everything saved forever in your movie database, even titles that aren't trending. Visitors only see a title once it has a poster, summary and a working video or trailer. Quarantined items failed the safety checks and are never shown.</p>
      <div className="space-y-2 rounded-xl border p-3">
        <div className="text-sm font-medium">Download my data</div>
        <div className="flex flex-wrap gap-2">
          <button disabled={!!exp} onClick={() => runExport("titles")} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs hover:bg-accent disabled:opacity-50">Saved titles only</button>
          <button disabled={!!exp} onClick={() => runExport("all")} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs hover:bg-accent disabled:opacity-50">Everything in the database</button>
        </div>
        {exp && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Preparing… {exp.count} records so far</p>}
        {expErr && <p role="alert" className="text-xs text-destructive">{expErr}</p>}
        {file && <button onClick={save} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm text-primary-foreground"><Download className="h-4 w-4" />Download {file.count} records</button>}
      </div>
      <div className="scrollbar-none flex gap-1 overflow-x-auto">
        <button className={chip(view === "saved")} onClick={() => setView("saved")}>Saved titles</button>
        <button className={chip(view === "quarantined")} onClick={() => setView("quarantined")}>Quarantined</button>
        {view === "saved" && (["all", "movie", "tv"] as const).map((k) => (
          <button key={k} className={chip(type === k)} onClick={() => setType(k)}>{k === "all" ? "All" : k === "movie" ? "Movies" : "TV"}</button>
        ))}
      </div>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter loaded titles by name" aria-label="Filter titles" className="h-10 w-full rounded-lg border bg-background px-3 text-sm" />
      {q.isPending && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-secondary" />)}</div>}
      {q.isError && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{err(q.error)} <button onClick={() => q.refetch()} className="ml-2 underline">Retry</button></div>}
      {!q.isPending && !q.isError && (
        <>
          <p className="text-xs text-muted-foreground">Showing {list.length} {view === "saved" ? "titles" : "items"}{q.hasNextPage ? " — load more to see the rest" : " — that's everything"}</p>
          {list.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing here yet.</p> : (
            <ul className="divide-y rounded-xl border">{list.map((i) => (
              <li key={i.key} className="flex items-center gap-3 p-2">
                {i.poster ? <img src={`https://image.tmdb.org/t/p/w92${i.poster}`} alt="" loading="lazy" className="h-12 w-8 shrink-0 rounded object-cover" /> : <div className="h-12 w-8 shrink-0 rounded bg-secondary" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{i.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {view === "saved"
                      ? <>{i.type === "tv" ? "TV" : "Movie"} · {i.date?.slice(0, 4) || "—"} · saved {i.savedAt ? new Date(i.savedAt).toLocaleDateString() : "—"}</>
                      : <span className="text-destructive">{i.reason ?? "Rejected"}</span>}
                  </div>
                </div>
                {view === "saved" && i.id && (
                  <Link to="/t/$type/$id" params={{ type: i.type === "tv" ? "tv" : "movie", id: String(i.id) }} className="inline-flex h-9 shrink-0 items-center rounded-lg border px-3 text-xs hover:bg-accent">Open</Link>
                )}
              </li>
            ))}</ul>
          )}
          {q.hasNextPage && (
            <button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border text-sm hover:bg-accent disabled:opacity-50" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
              {q.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}Load more
            </button>
          )}
        </>
      )}
    </div>
  );
}
