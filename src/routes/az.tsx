import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Chip, DiscoverGrid, PlayableChip, useGenres } from "@/components/Browse";
import { Page } from "@/components/lg";

export const Route = createFileRoute("/az")({
  head: () => ({
    meta: [
      { title: "A–Z — LoopgramChannel" },
      { name: "description", content: "Browse movies and TV alphabetically from A to Z." },
      { property: "og:title", content: "A–Z — LoopgramChannel" },
      { property: "og:description", content: "Alphabetical movie and TV browsing." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AZ,
});

function AZ() {
  const [type, setType] = useState<"movie" | "tv">("movie");
  const [genre, setGenre] = useState<number | null>(null);
  const g = useGenres();
  return (
    <Page title="A–Z">
      <p className="px-4 pb-2 text-sm text-muted-foreground">Titles sorted alphabetically (titles with 50+ votes), using TMDB's own title ordering.</p>
      <div className="flex gap-2 px-4"><Chip active={type === "movie"} onClick={() => { setType("movie"); setGenre(null); }}>Movies</Chip><Chip active={type === "tv"} onClick={() => { setType("tv"); setGenre(null); }}>TV</Chip><span className="mx-1 w-px bg-border" /><PlayableChip /></div>
      <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 py-3">
        <Chip active={genre === null} onClick={() => setGenre(null)}>All genres</Chip>
        {g.data?.[type].map((x) => <Chip key={x.id} active={genre === x.id} onClick={() => setGenre(x.id)}>{x.name}</Chip>)}
      </div>
      <DiscoverGrid type={type} sort={type === "movie" ? "title.asc" : "name.asc"} genre={genre ? String(genre) : undefined} />
    </Page>
  );
}
