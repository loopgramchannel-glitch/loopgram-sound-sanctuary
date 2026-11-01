import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Users } from "lucide-react";
import { Page } from "@/components/lg";
import { PARTY_CODE } from "@/lib/social";
import { useLive } from "@/lib/use-live";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "Loop Party — Watch Together | LoopgramChannel" },
      { name: "description", content: "Watch movies, shows and channel videos in sync with friends, with live chat." },
      { property: "og:title", content: "Loop Party on LoopgramChannel" },
      { property: "og:description", content: "Start or join a watch-together party with live chat." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LivePage,
});

function LivePage() {
  const live = useLive();
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const clean = code.trim().toUpperCase();
  return (
    <Page>
      <div className="space-y-6 p-4">
        <section className="rounded-2xl border bg-card p-5">
          <h1 className="flex items-center gap-2 text-2xl font-black"><Users className="h-6 w-6 text-primary" />Loop Party</h1>
          {!live.partyOn ? <p className="mt-2 text-sm text-muted-foreground">Watch parties are closed right now. Please check back later.</p> : <>
            <p className="mt-2 text-sm text-muted-foreground">Open {live.partyTmdb && live.partyPosts ? "any movie, show or channel video" : live.partyTmdb ? "any movie or show" : "any channel video"} and tap <b>Watch together</b>. Send the link to friends — everyone plays and pauses at the same moment{live.partyChat ? ", with live chat" : ""}.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {live.partyTmdb && <Link to="/explore" className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Pick a movie or show</Link>}
              {live.partyPosts && <Link to="/posts" className="rounded-full bg-secondary px-4 py-2 text-sm font-semibold">Pick a channel video</Link>}
            </div>
          </>}
        </section>
        {live.partyOn && <form className="rounded-2xl border p-5" onSubmit={(e) => { e.preventDefault(); if (PARTY_CODE.test(clean)) nav({ to: "/party/$code", params: { code: clean } }); }}>
          <h2 className="font-bold">Have a party code?</h2>
          <div className="mt-2 flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} placeholder="6-letter code" aria-label="Party code" className="h-10 w-40 rounded-lg border bg-background px-3 uppercase tracking-widest" />
            <button disabled={!PARTY_CODE.test(clean)} className="rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">Join</button>
          </div>
        </form>}
      </div>
    </Page>
  );
}
