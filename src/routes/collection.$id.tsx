import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox, Grid, Page } from "@/components/lg";

export const Route = createFileRoute("/collection/$id")({
  head: () => ({
    meta: [
      { title: "Collection — LoopgramChannel" },
      { name: "description", content: "Every film in this collection, in release order." },
      { property: "og:title", content: "Collection — LoopgramChannel" },
      { property: "og:description", content: "Every film in this collection." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CollectionPage,
});

function CollectionPage() {
  const { id } = Route.useParams();
  const q = useQuery({ queryKey: ["collection", id], queryFn: () => api({ a: "collection", id }), staleTime: 60 * 60_000 });
  if (q.isPending) return <Page><div className="m-4 h-40 animate-pulse rounded-xl bg-muted" /></Page>;
  if (q.isError) return <Page><ErrorBox error={q.error} retry={() => q.refetch()} /></Page>;
  return (
    <Page title={q.data.name}>
      <p className="max-w-3xl px-4 pb-4 text-sm text-muted-foreground">{q.data.overview}</p>
      <Grid items={q.data.parts} />
    </Page>
  );
}
