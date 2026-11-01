import { img } from "@/lib/api";

export type ProviderInfo = { link: string; items: { id: number; name: string; logo: string | null; kind: string }[] } | null;

/** Official licensed services where the full movie or episode is available (data from TMDB / JustWatch). */
export function Providers({ data, title }: { data: ProviderInfo; title: string }) {
  if (!data?.items.length) return null;
  return (
    <section className="mt-3">
      <h2 className="text-sm font-bold">Watch the full {title}</h2>
      <div className="scrollbar-none -mx-4 mt-2 flex gap-3 overflow-x-auto px-4">
        {data.items.map((p) => (
          <a key={`${p.id}-${p.kind}`} href={data.link} target="_blank" rel="noopener noreferrer" title={`${p.kind} on ${p.name}`}
            className="flex w-16 shrink-0 flex-col items-center gap-1 text-center">
            {p.logo ? <img src={img(p.logo, "w92")!} alt={p.name} loading="lazy" className="h-12 w-12 rounded-xl object-cover shadow" />
              : <span className="grid h-12 w-12 place-items-center rounded-xl bg-secondary text-xs font-bold">{p.name.slice(0, 2)}</span>}
            <span className="line-clamp-1 text-[10px] text-muted-foreground">{p.kind}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
