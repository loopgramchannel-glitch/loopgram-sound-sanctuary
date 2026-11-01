// Studio: owner controls for Loop Party (TMDB titles and owner posts). Every list shows real rooms from Redis only.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, MessageSquareOff, Users, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { studioClearChat, studioEndAll, studioEndParty, studioLive, studioLiveSave } from "@/lib/social.functions";
import type { LiveSettingsT } from "@/lib/live-settings";

const btn = "inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-xs hover:bg-accent disabled:opacity-50";
const err = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^\d{3}:\s*/, "");

function Toggle({ on, set, label, note }: { on: boolean; set: (v: boolean) => void; label: string; note?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" checked={on} onChange={(e) => set(e.target.checked)} />
      <span>{label}{note && <span className="block text-xs text-muted-foreground">{note}</span>}</span>
    </label>
  );
}

export function LivePanel() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const call = async <T,>(fn: (a: { data: any }) => Promise<T>, extra: Record<string, unknown> = {}) => {
    const token = await getToken(); if (!token) throw new Error("Not signed in");
    return fn({ data: { token, ...extra } });
  };
  const q = useQuery({ queryKey: ["studio", "live"], queryFn: () => call(studioLive), refetchInterval: 10_000 });
  const [f, setF] = useState<LiveSettingsT | null>(null);
  useEffect(() => { if (q.data && !f) setF(q.data.settings); }, [q.data]);

  const save = useMutation({
    mutationFn: () => call(studioLiveSave, { settings: f }),
    onSuccess: () => { toast.success("Saved. Visitors see it within a minute."); qc.invalidateQueries({ queryKey: ["studio", "live"] }); qc.invalidateQueries({ queryKey: ["live-settings"] }); },
    onError: (e) => toast.error(err(e)),
  });
  const end = useMutation({ mutationFn: (code: string) => call(studioEndParty, { code }), onSuccess: () => { toast.success("Party ended"); q.refetch(); }, onError: (e) => toast.error(err(e)) });
  const clear = useMutation({ mutationFn: (code: string) => call(studioClearChat, { code }), onSuccess: () => toast.success("Chat cleared"), onError: (e) => toast.error(err(e)) });
  const endAll = useMutation({ mutationFn: () => call(studioEndAll), onSuccess: (r) => { toast.success(`Ended ${r.ended} parties`); q.refetch(); }, onError: (e) => toast.error(err(e)) });

  if (q.isError) return <div className="rounded-xl border p-4 text-sm text-destructive">{err(q.error)} <button className="underline" onClick={() => q.refetch()}>Retry</button></div>;
  if (!f || !q.data) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  const set = (p: Partial<LiveSettingsT>) => setF({ ...f, ...p });
  const parties = q.data.parties;
  const watching = parties.reduce((n, p) => n + p.people, 0);

  return (
    <div className="max-w-3xl space-y-4">
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="flex items-center gap-2 font-bold"><Users className="h-5 w-5" />Loop Party settings</h2>
        <Toggle on={f.partyOn} set={(v) => set({ partyOn: v })} label="Allow watch parties on my website" note="Turning this off also closes parties that are open now." />
        <div className="ml-6 space-y-2">
          <Toggle on={f.partyTmdb} set={(v) => set({ partyTmdb: v })} label="Movies & TV (trailers)" />
          <Toggle on={f.partyPosts} set={(v) => set({ partyPosts: v })} label="My channel videos (my posts)" note="Uploaded video/audio files and YouTube links." />
          <Toggle on={f.partyChat} set={(v) => set({ partyChat: v })} label="Live chat inside parties" />
        </div>
        <label className="block text-sm">Most parties open at the same time
          <input type="number" min={1} max={100000} value={f.maxParties} onChange={(e) => set({ maxParties: Math.max(1, Math.min(100000, Number(e.target.value) || 1)) })} className="ml-2 h-8 w-28 rounded border bg-background px-2" />
        </label>
        <button onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save
        </button>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">Parties happening now ({parties.length}) · {watching} watching</h2>
          {parties.length > 0 && <button className={btn} disabled={endAll.isPending} onClick={() => { if (confirm("End every open party?")) endAll.mutate(); }}><X className="h-3 w-3" />End all</button>}
        </div>
        {!parties.length ? <p className="text-xs text-muted-foreground">No parties are open right now. They appear here as soon as a visitor taps Watch together.</p> : (
          <ul className="divide-y rounded-lg border">
            {parties.map((p) => (
              <li key={p.code} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
                <span className="min-w-0 truncate"><b>{p.code}</b> · {p.title} <span className="text-xs text-muted-foreground">({p.type === "post" ? "my video" : p.type} · {p.people} watching · {p.playing ? "playing" : "paused"})</span></span>
                <span className="flex shrink-0 gap-1">
                  <a href={`/party/${p.code}`} target="_blank" rel="noreferrer" className={btn}>Open</a>
                  <button className={btn} disabled={clear.isPending} onClick={() => clear.mutate(p.code)}><MessageSquareOff className="h-3 w-3" />Clear chat</button>
                  <button className={btn} disabled={end.isPending} onClick={() => end.mutate(p.code)}><X className="h-3 w-3" />End</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
