import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { img } from "@/lib/api";
import { setState, toggleFollow, toggleSave, useStore } from "@/lib/store";
import { Chip } from "@/components/Browse";
import { Page } from "@/components/lg";

export const Route = createFileRoute("/watchlist")({
  head: () => ({
    meta: [
      { title: "Saved — LoopgramChannel" },
      { name: "description", content: "Your watchlist, followed people and release alerts, stored on this device." },
      { property: "og:title", content: "Saved — LoopgramChannel" },
      { property: "og:description", content: "Your watchlist and alerts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Watchlist,
});

function Watchlist() {
  const list = useStore((s) => s.watchlist);
  const follows = useStore((s) => s.follows);
  const alerts = useStore((s) => s.alerts);
  const [sort, setSort] = useState<"added" | "release" | "title">("added");
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...list].sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : sort === "release" ? (a.date ?? "9").localeCompare(b.date ?? "9") : b.added - a.added);
  const upcoming = list.filter((w) => w.date && w.date >= today).length;
  return (
    <Page title="Saved">
      {alerts.length > 0 && (
        <section className="mx-4 mb-4 rounded-xl border p-3">
          <div className="flex items-center justify-between"><h2 className="font-bold">Release alerts</h2><button className="text-xs text-muted-foreground" onClick={() => setState((s) => ({ ...s, alerts: [] }))}>Clear</button></div>
          <ul className="mt-1 space-y-1 text-sm">{alerts.map((a) => <li key={a.key + a.at}>• {a.text}</li>)}</ul>
        </section>
      )}
      <div className="flex items-center gap-2 px-4">
        <p className="mr-auto text-sm text-muted-foreground">{list.length} saved · {upcoming} upcoming</p>
        <Chip active={sort === "added"} onClick={() => setSort("added")}>Recent</Chip>
        <Chip active={sort === "release"} onClick={() => setSort("release")}>Release</Chip>
        <Chip active={sort === "title"} onClick={() => setSort("title")}>A–Z</Chip>
      </div>
      {list.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Nothing saved yet. Tap the bookmark on any title.</p> : (
        <ul className="divide-y px-4 pt-2">
          {sorted.map((w) => (
            <li key={w.key} className="flex items-center gap-3 py-2">
              <Link to="/t/$type/$id" params={{ type: w.type, id: String(w.id) }} className="flex min-w-0 flex-1 items-center gap-3">
                <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-muted">{w.poster && <img src={img(w.poster, "w185")!} alt="" loading="lazy" className="h-full w-full object-cover" />}</div>
                <div className="min-w-0"><p className="truncate font-medium">{w.title}</p><p className="text-xs text-muted-foreground">{w.type === "tv" ? "TV" : "Movie"} · {w.date ? (w.date >= today ? `Releases ${w.date}` : w.date.slice(0, 4)) : "TBA"}</p></div>
              </Link>
              <button onClick={() => toggleSave(w)} className="rounded-full px-3 py-1 text-xs hover:bg-accent" aria-label={`Remove ${w.title}`}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {follows.length > 0 && (
        <section className="pt-6">
          <h2 className="px-4 text-lg font-bold">Following</h2>
          <div className="scrollbar-none mt-2 flex gap-3 overflow-x-auto px-4">
            {follows.map((f) => (
              <div key={f.id} className="w-20 shrink-0 text-center">
                <Link to="/person/$id" params={{ id: String(f.id) }}>
                  <div className="mx-auto h-16 w-16 overflow-hidden rounded-full bg-muted">{f.profile && <img src={img(f.profile, "w185")!} alt="" className="h-full w-full object-cover" />}</div>
                  <p className="mt-1 line-clamp-2 text-xs">{f.name}</p>
                </Link>
                <button onClick={() => toggleFollow(f)} className="text-[10px] text-muted-foreground">Unfollow</button>
              </div>
            ))}
          </div>
        </section>
      )}
      <p className="px-4 pt-8 text-xs text-muted-foreground">Everything here stays on this device. No account needed.
        <button className="ml-2 underline" onClick={() => { if (confirm("Reset your taste profile?")) setState((s) => ({ ...s, signals: { genres: {}, people: {}, titles: {} } })); }}>Reset taste profile</button></p>
    </Page>
  );
}
