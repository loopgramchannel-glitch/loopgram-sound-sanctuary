import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, img } from "@/lib/api";
import { setState, useStore } from "@/lib/store";
import { ErrorBox, Page, type Item } from "@/components/lg";

export const Route = createFileRoute("/game")({
  head: () => ({
    meta: [
      { title: "Daily Discovery Game — LoopgramChannel" },
      { name: "description", content: "Guess today's trending movie from clues revealed one at a time. Keep your streak alive." },
      { property: "og:title", content: "Daily Discovery Game — LoopgramChannel" },
      { property: "og:description", content: "One new movie puzzle every day. Fewer clues, higher score." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Game,
});

type GameData = { date: string; answer_id: number; year: string; clues: string[]; options: Item[] };

function Game() {
  // One puzzle per day: cache it for hours so huge traffic hits the cached copy, not the server.
  const q = useQuery({ queryKey: ["game"], queryFn: () => api<GameData>({ a: "game" }), staleTime: 6 * 60 * 60_000, gcTime: 24 * 60 * 60_000 });
  const results = useStore((s) => s.game);
  const [shown, setShown] = useState(1);

  if (q.isPending)
    return (
      <Page title="Daily Discovery">
        <div className="space-y-3 px-4">
          <div className="h-28 animate-pulse rounded-2xl bg-muted" />
          <div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>
        </div>
      </Page>
    );
  if (q.isError) return <Page title="Daily Discovery"><ErrorBox error={q.error} retry={() => q.refetch()} /></Page>;

  const g = q.data;
  const done = results[g.date];
  const streak = (() => { let n = 0; const d = new Date(g.date); while (results[d.toISOString().slice(0, 10)]?.correct) { n++; d.setDate(d.getDate() - 1); } return n; })();
  const answer = g.options.find((o) => o.id === g.answer_id)!;
  // Clue 1 is the release year (vague); cast names come one by one after.
  const clues = [g.year ? `Released in ${g.year}` : "A trending movie right now", ...g.clues.map((c) => `Stars ${c}`)];
  const visible = done ? clues.length : Math.min(shown, clues.length);
  const score = Math.max(1, clues.length - visible + 1);

  const pick = (id: number) => {
    if (done) return;
    setState((s) => ({ ...s, game: { ...s.game, [g.date]: { picked: id, correct: id === g.answer_id } } }));
  };
  const share = () => {
    const bar = clues.map((_, i) => (i < visible ? "🟨" : "⬛")).join("");
    const t = `LoopgramChannel Daily ${g.date}\n${done?.correct ? "✅" : "❌"} ${bar}\n🔥 Streak ${streak}`;
    import("@/lib/share").then((m) => m.shareLink({ text: t, url: location.origin + "/game" }));
  };

  // Mystery poster: heavily blurred at first, sharper with every clue, clear once solved.
  const blur = done ? 0 : Math.max(4, 28 - (visible - 1) * 7);
  const pct = Math.round((visible / clues.length) * 100);

  return (
    <Page title="Daily Discovery">
      <div className="mx-auto w-full max-w-xl px-4 pb-12">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-3xl border bg-card">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/30 via-transparent to-accent/20" />
          <div className="relative flex gap-4 p-4">
            <div className="relative h-40 w-28 shrink-0 overflow-hidden rounded-2xl bg-muted shadow-lg ring-1 ring-border">
              {answer.poster_path && (
                <img
                  src={img(answer.poster_path, "w185")!}
                  alt={done ? answer.title : "Mystery poster"}
                  className="h-full w-full scale-110 object-cover transition-[filter] duration-700"
                  style={{ filter: `blur(${blur}px)` }}
                />
              )}
              {!done && <span className="absolute inset-0 grid place-items-center text-4xl font-black text-foreground/80">?</span>}
            </div>
            <div className="min-w-0 flex-1">
              <span className="inline-block rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">Daily puzzle · {g.date.slice(5)}</span>
              <h2 className="mt-2 text-2xl font-black leading-tight">Name that movie</h2>
              <p className="mt-1 text-xs text-muted-foreground">The poster gets clearer with every clue. Guess early for a bigger score.</p>
              <div className="mt-3 flex gap-2 text-xs font-semibold">
                <span className="rounded-full bg-secondary px-2.5 py-1">🔥 {streak} streak</span>
                <span className="rounded-full bg-secondary px-2.5 py-1">⭐ {done ? (done.correct ? score : 0) : score} pts</span>
              </div>
            </div>
          </div>
          <div className="relative h-1.5 bg-muted">
            <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </section>

        {done && (
          <div role="status" className={`mt-4 rounded-3xl border-2 p-4 ${done.correct ? "border-primary bg-primary/10" : "border-destructive bg-destructive/10"}`}>
            <p className="text-2xl font-black">{done.correct ? "You got it! 🎉" : "So close!"}</p>
            <p className="mt-1 text-sm">The answer is <b>{answer.title}</b></p>
            <p className="text-xs text-muted-foreground">{done.correct ? `Solved with ${visible} clue${visible > 1 ? "s" : ""} — challenge your friends to beat it` : "New puzzle tomorrow — keep your streak going"}</p>
            <div className="mt-3 flex justify-center gap-1 text-lg" aria-hidden>
              {clues.map((_, i) => <span key={i}>{i < visible ? "🟨" : "⬛"}</span>)}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={share} className="rounded-full bg-primary py-2.5 text-sm font-bold text-primary-foreground">Challenge friends</button>
              <Link to="/t/$type/$id" params={{ type: "movie", id: String(answer.id) }} className="rounded-full border py-2.5 text-center text-sm font-semibold">Watch it</Link>
            </div>
          </div>
        )}

        {/* Clues */}
        <section className="mt-4 rounded-3xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Clues</p>
            <p className="text-xs font-semibold text-muted-foreground">{visible}/{clues.length}</p>
          </div>
          <ol className="mt-3 space-y-2">
            {clues.map((c, i) => (
              <li key={i} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${i < visible ? "bg-secondary" : "border border-dashed text-muted-foreground"}`}>
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${i < visible ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{i + 1}</span>
                <span className="min-w-0 font-medium">{i < visible ? c : "Locked clue"}</span>
              </li>
            ))}
          </ol>
          {!done && visible < clues.length && (
            <button onClick={() => setShown(visible + 1)} className="mt-3 w-full rounded-full border-2 border-primary py-2.5 text-sm font-bold text-primary">
              Reveal clue {visible + 1} (−1 pt)
            </button>
          )}
        </section>

        {/* Answers */}
        <p className="mt-5 text-xs font-bold uppercase tracking-wider text-muted-foreground">{done ? "Answers" : "Pick your answer"}</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {g.options.map((o) => {
            const isAnswer = o.id === g.answer_id;
            const isPicked = done?.picked === o.id;
            const cls = !done
              ? "border-border bg-card active:scale-95 hover:border-primary hover:bg-primary/5"
              : isAnswer
                ? "border-primary bg-primary/15 ring-2 ring-primary"
                : isPicked
                  ? "border-destructive bg-destructive/15 line-through"
                  : "border-border opacity-50";
            return (
              <button
                key={o.id}
                onClick={() => pick(o.id)}
                disabled={!!done}
                aria-label={o.title}
                className={`flex min-h-16 items-center justify-between gap-2 rounded-2xl border-2 p-3 text-left text-sm font-semibold transition ${cls}`}
              >
                <span className="min-w-0 break-words">{o.title}</span>
                {done && isAnswer && <span className="shrink-0" aria-hidden>✓</span>}
                {done && isPicked && !isAnswer && <span className="shrink-0" aria-hidden>✗</span>}
              </button>
            );
          })}
        </div>
      </div>
    </Page>
  );
}

