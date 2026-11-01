import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, img } from "@/lib/api";
import { toggleFollow, useStore } from "@/lib/store";
import { ErrorBox, Grid, Page } from "@/components/lg";

export const Route = createFileRoute("/person/$id")({
  head: () => ({
    meta: [
      { title: "Person — LoopgramChannel" },
      { name: "description", content: "Biography and full filmography on LoopgramChannel." },
      { property: "og:title", content: "Person — LoopgramChannel" },
      { property: "og:description", content: "Biography and filmography." },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PersonPage,
});

function PersonPage() {
  const { id } = Route.useParams();
  const q = useQuery({ queryKey: ["person", id], queryFn: () => api({ a: "person", id }), staleTime: 60 * 60_000 });
  const following = useStore((s) => s.follows.some((f) => String(f.id) === id));
  if (q.isPending) return <Page><div className="m-4 h-40 animate-pulse rounded-xl bg-muted" /></Page>;
  if (q.isError) return <Page><ErrorBox error={q.error} retry={() => q.refetch()} /></Page>;
  const d = q.data;
  const ageAt = (b: string, e?: string | null) => { const s = new Date(b), t = e ? new Date(e) : new Date(); let a = t.getFullYear() - s.getFullYear(); if (t.getMonth() < s.getMonth() || (t.getMonth() === s.getMonth() && t.getDate() < s.getDate())) a--; return a; };
  const fmt = (s: string) => new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const links = Object.entries(d.links ?? {}).filter(([, v]) => v) as [string, string][];
  const label: Record<string, string> = { imdb: "IMDb", instagram: "Instagram", twitter: "X / Twitter", tiktok: "TikTok", facebook: "Facebook", homepage: "Website" };
  const facts: [string, string][] = [];
  if (d.known_for) facts.push(["Known for", d.known_for]);
  if (d.birthday) facts.push(["Born", `${fmt(d.birthday)}${d.deathday ? "" : ` (age ${ageAt(d.birthday)})`}`]);
  if (d.deathday) facts.push(["Died", `${fmt(d.deathday)}${d.birthday ? ` (aged ${ageAt(d.birthday, d.deathday)})` : ""}`]);
  if (d.place_of_birth) facts.push(["Birthplace", d.place_of_birth]);
  if (d.total_credits) facts.push(["Credits", String(d.total_credits)]);
  if (d.aliases?.length) facts.push(["Also known as", d.aliases.join(", ")]);
  return (
    <Page>
      <div className="flex gap-4 p-4">
        <div className="h-28 w-28 shrink-0 overflow-hidden rounded-full bg-muted">{d.profile_path && <img src={img(d.profile_path, "w185")!} alt="" className="h-full w-full object-cover" />}</div>
        <div>
          <h1 className="text-2xl font-bold">{d.name}</h1>
          <button onClick={() => toggleFollow({ id: d.id, name: d.name, profile: d.profile_path })} className={`mt-2 rounded-full px-5 py-2 text-sm font-semibold ${following ? "bg-secondary" : "bg-primary text-primary-foreground"}`}>{following ? "Following" : "Follow"}</button>
        </div>
      </div>
      {facts.length > 0 && (
        <dl className="mx-4 mb-4 grid grid-cols-1 gap-x-6 gap-y-2 rounded-xl bg-muted/50 p-4 text-sm sm:grid-cols-2">
          {facts.map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>)}
        </dl>
      )}
      {links.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          {links.map(([k, v]) => <a key={k} href={v} target="_blank" rel="noopener noreferrer" className="rounded-full border px-3 py-1 text-xs font-medium hover:bg-secondary">{label[k] ?? k}</a>)}
        </div>
      )}
      {d.biography && <p className="max-w-3xl whitespace-pre-line px-4 pb-4 text-sm leading-relaxed text-muted-foreground line-clamp-[12]">{d.biography}</p>}
      <h2 className="px-4 pb-2 text-lg font-bold">Known for</h2>
      <Grid items={d.credits} />
      <h2 className="px-4 pb-2 pt-6 text-lg font-bold">Roles</h2>
      <ul className="divide-y px-4 text-sm">
        {d.credits.map((c: any) => (
          <li key={`${c.media_type}${c.id}`} className="flex justify-between gap-3 py-2">
            <span className="min-w-0"><span className="font-medium">{c.title ?? c.name}</span>{c.credit_role && <span className="text-muted-foreground"> — {c.credit_role}</span>}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{[c.credit_dept, c.media_type === "tv" ? "TV" : "Movie", c.credit_episodes ? `${c.credit_episodes} eps` : null, (c.date ?? c.release_date ?? c.first_air_date)?.slice(0, 4)].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
      </ul>
    </Page>
  );
}
