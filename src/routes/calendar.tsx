import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toggleSave, useStore } from "@/lib/store";
import { ErrorBox, Page, Poster, Row, type Item } from "@/components/lg";

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Release Calendar — LoopgramChannel" },
      { name: "description", content: "Upcoming movie releases and TV shows on the air, with release alerts." },
      { property: "og:title", content: "Release Calendar — LoopgramChannel" },
      { property: "og:description", content: "Upcoming releases and alerts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Calendar,
});

function Calendar() {
  const q = useQuery({ queryKey: ["calendar"], queryFn: () => api<{ today: string; movies: Item[]; tv: Item[] }>({ a: "calendar" }), staleTime: 30 * 60_000 });
  const wl = useStore((s) => s.watchlist);
  const saved = new Set(wl.map((w) => w.key));
  if (q.isPending) return <Page title="Release Calendar"><p className="px-4 text-sm text-muted-foreground">Loading…</p></Page>;
  if (q.isError) return <Page title="Release Calendar"><ErrorBox error={q.error} retry={() => q.refetch()} /></Page>;
  const byDate = new Map<string, Item[]>();
  for (const m of q.data.movies) byDate.set(m.date!, [...(byDate.get(m.date!) ?? []), m]);
  const askNotify = () => { if ("Notification" in window) Notification.requestPermission(); };
  return (
    <Page title="Release Calendar">
      <div className="flex items-center gap-2 px-4 pb-2 text-sm text-muted-foreground">
        <span>Get an alert once when a saved title releases.</span>
        <button onClick={askNotify} className="rounded-full bg-secondary px-3 py-1 text-xs text-foreground">Enable notifications</button>
      </div>
      <Row title="TV on the air" items={q.data.tv} />
      {[...byDate.entries()].map(([date, items]) => (
        <section key={date} className="py-2">
          <h2 className="px-4 text-sm font-bold">{new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</h2>
          <div className="scrollbar-none mt-2 flex gap-3 overflow-x-auto px-4">
            {items.map((i) => (
              <div key={i.id} className="w-32 shrink-0">
                <Poster item={i} w="w-32" />
                <button onClick={() => toggleSave({ id: i.id, type: "movie", title: i.title, poster: i.poster_path, date: i.date ?? null, genre_ids: i.genre_ids ?? [] })} className="mt-1 w-full rounded-full bg-secondary py-1 text-xs">
                  {saved.has(`movie:${i.id}`) ? "✓ Alert set" : "Remind me"}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </Page>
  );
}
