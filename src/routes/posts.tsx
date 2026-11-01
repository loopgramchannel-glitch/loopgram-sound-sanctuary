import { usePostStats } from "@/lib/use-post-stats";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { PostTile } from "@/components/PostTile";
import { postsQuery } from "@/lib/posts-query";
import { Page } from "@/components/lg";
import { postIsShort, useRatios } from "@/components/PostView";
import { ShortTile, ShortsShelf } from "@/components/Shorts";

export const Route = createFileRoute("/posts")({
  validateSearch: z.object({ c: z.string().max(40).optional() }),
  head: () => ({
    meta: [
      { title: "Posts — LoopgramChannel" },
      { name: "description", content: "Latest videos, gaming, music and news posted by LoopgramChannel." },
      { property: "og:title", content: "Posts — LoopgramChannel" },
      { property: "og:description", content: "Latest videos, gaming, music and news posted by LoopgramChannel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(postsQuery),
  component: PostsPage,
});

function PostsPage() {
  const { data } = useSuspenseQuery(postsQuery);
  const { c } = Route.useSearch();
  const ratios = useRatios(data.map((p) => p.videoUrl));
  const short = (p: (typeof data)[number]) => postIsShort(p, ratios);
  const stats = usePostStats(data.map((p) => p.id));
  const cats = [...new Set(data.map((p) => p.category).filter(Boolean))];
  const inCat = c && c !== "Shorts" && c !== "Videos" ? data.filter((p) => p.category === c) : data;
  const shorts = inCat.filter(short);
  const videos = inCat.filter((p) => !short(p));
  const chip = (on: boolean) => `shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${on ? "bg-foreground text-background" : "bg-secondary hover:bg-accent"}`;
  const grid = (list: typeof data) => (
    <div className="grid grid-cols-1 gap-y-6 pb-6 sm:grid-cols-2 sm:gap-x-4 sm:px-4 lg:grid-cols-3 xl:grid-cols-4">
      {list.map((p) => <PostTile key={p.id} post={p} views={stats[p.id]?.views} />)}
    </div>
  );
  return (
    <Page>
      <h1 className="sr-only">Posts</h1>
      <div className="scrollbar-none sticky top-14 z-20 flex gap-2 overflow-x-auto bg-background px-4 py-3">
        <Link to="/posts" search={{}} className={chip(!c)}>All</Link>
        <Link to="/posts" search={{ c: "Shorts" }} className={chip(c === "Shorts")}>Shorts</Link>
        <Link to="/posts" search={{ c: "Videos" }} className={chip(c === "Videos")}>Videos</Link>
        {cats.map((x) => <Link key={x} to="/posts" search={{ c: x }} className={chip(c === x)}>{x}</Link>)}
      </div>
      {inCat.length === 0 ? <p className="px-4 text-sm text-muted-foreground">Nothing posted here yet.</p>
        : c === "Shorts" ? (
          shorts.length ? <div className="grid grid-cols-2 gap-2 px-2 pb-6 sm:grid-cols-3 sm:px-4 lg:grid-cols-5 xl:grid-cols-6">{shorts.map((p) => <ShortTile key={p.id} post={p} className="w-full" />)}</div>
            : <p className="px-4 text-sm text-muted-foreground">No Shorts yet.</p>
        ) : c === "Videos" ? (videos.length ? grid(videos) : <p className="px-4 text-sm text-muted-foreground">No videos yet.</p>) : (
          <>
            {grid(videos.slice(0, 4))}
            <ShortsShelf posts={shorts} />
            {grid(videos.slice(4))}
          </>
        )}
    </Page>
  );
}
