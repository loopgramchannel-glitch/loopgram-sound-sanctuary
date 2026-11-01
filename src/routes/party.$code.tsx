import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Copy, Pause, Play, Share2, Users } from "lucide-react";
import { Page } from "@/components/lg";
import { LiveChat, useMe } from "@/components/LiveChat";
import { PARTY_CODE, partyPosition } from "@/lib/social";
import { controlParty, getParty, partyChat, partyPing } from "@/lib/social.functions";
import { shareLink } from "@/lib/share";

export const Route = createFileRoute("/party/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Loop Party ${params.code} — Watch Together | LoopgramChannel` },
      { name: "description", content: "You're invited to watch together on LoopgramChannel. Video stays in sync for everyone, with live chat." },
      { property: "og:title", content: "Join my Loop Party on LoopgramChannel" },
      { property: "og:description", content: "Tap to watch together in sync with live chat." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PartyPage,
});

function PartyPage() {
  const { code } = Route.useParams();
  const valid = PARTY_CODE.test(code);
  const q = useQuery({ queryKey: ["party", code], queryFn: () => getParty({ data: { code } }), refetchInterval: 1500, enabled: valid });
  const { me } = useMe();
  const [hostKey, setHostKey] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const local = useRef(0); // player's own reported time
  const lastV = useRef(0);
  const skew = useRef(0);

  useEffect(() => { setHostKey(localStorage.getItem(`lg:party:${code}`)); }, [code]);
  useEffect(() => {
    if (!me || !valid) return;
    const ping = () => partyPing({ data: { code, me: me.id } }).catch(() => {});
    ping(); const t = setInterval(ping, 20_000); return () => clearInterval(t);
  }, [me?.id, code]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      try { const m = typeof e.data === "string" ? JSON.parse(e.data) : e.data; if (typeof m?.info?.currentTime === "number") local.current = m.info.currentTime; } catch {}
    };
    addEventListener("message", onMsg); return () => removeEventListener("message", onMsg);
  }, []);

  const d = q.data;
  const isFile = !!d?.state.file;
  // One control surface for both players: YouTube embed (trailers, YouTube posts) or a native player (owner uploads).
  const cmd = (func: "seekTo" | "playVideo" | "pauseVideo", args: unknown[] = []) => {
    const v = vid.current;
    if (isFile) {
      if (!v) return;
      if (func === "seekTo") { try { v.currentTime = Number(args[0]) || 0; } catch {} }
      else if (func === "playVideo") v.play().catch(() => {});
      else v.pause();
      return;
    }
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  };
  if (d) skew.current = d.now - Date.now();

  // Apply host state: on every new version, and drift-correct when >2s off.
  useEffect(() => {
    if (!d || !joined) return;
    const target = partyPosition(d.state, Date.now() + skew.current);
    const changed = d.state.v !== lastV.current;
    lastV.current = d.state.v;
    if (changed || Math.abs(local.current - target) > 2) cmd("seekTo", [target, true]);
    if (changed) cmd(d.state.playing ? "playVideo" : "pauseVideo");
  }, [d?.state.v, d?.now, joined]);

  if (!valid) return <Page><p className="p-6">This party link isn't valid.</p></Page>;
  if (q.isPending) return <Page><div className="aspect-video animate-pulse bg-muted" /></Page>;
  if (!d) return <Page><div className="p-6"><p className="font-semibold">This party has ended or doesn't exist.</p><Link to="/live" className="mt-3 inline-block text-primary underline">Start or join another party</Link></div></Page>;

  const isHost = !!hostKey;
  const control = async (playing: boolean) => {
    if (!hostKey) return;
    const pos = local.current || partyPosition(d.state, Date.now() + skew.current);
    await controlParty({ data: { code, hostKey, playing, pos } });
    q.refetch();
  };
  const url = typeof location !== "undefined" ? location.href : "";
  const origin = typeof location !== "undefined" ? location.origin : "";

  return (
    <Page>
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {joined && isFile ? (
          <video ref={vid} src={d.state.file} playsInline onTimeUpdate={(e) => { local.current = e.currentTarget.currentTime; }}
            onLoadedMetadata={() => { const t = partyPosition(d.state, Date.now() + skew.current); cmd("seekTo", [t]); if (d.state.playing) cmd("playVideo"); }}
            className="h-full w-full bg-muted" />
        ) : joined ? (
          <iframe ref={frame} onLoad={() => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*")}
            className="h-full w-full" title={d.state.title}
            src={`https://www.youtube-nocookie.com/embed/${d.state.video}?autoplay=1&playsinline=1&rel=0&controls=0&disablekb=1&enablejsapi=1&origin=${encodeURIComponent(origin)}`}
            allow="autoplay; encrypted-media; fullscreen" allowFullScreen />
        ) : (
          <div className="grid h-full place-items-center">
            {!isFile && <img src={`https://i.ytimg.com/vi/${d.state.video}/hqdefault.jpg`} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />}
            <button onClick={() => setJoined(true)} className="relative inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground"><Play className="h-5 w-5" />Join the party</button>
          </div>
        )}
      </div>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">{d.state.title}</h1>
            <p className="flex items-center gap-1 text-sm text-muted-foreground"><Users className="h-4 w-4" />{d.people} watching · Code {code}{isHost && " · You're the host"}</p>
          </div>
          <div className="flex gap-2">
            {isHost && joined && <button onClick={() => control(!d.state.playing)} className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">{d.state.playing ? <><Pause className="h-4 w-4" />Pause all</> : <><Play className="h-4 w-4" />Play for all</>}</button>}
            <button onClick={() => { shareLink({ title: "Loop Party", text: `Watch ${d.state.title} with me on LoopgramChannel`, url }) }} className="inline-flex items-center gap-1 rounded-full bg-secondary px-4 py-2 text-sm"><Share2 className="h-4 w-4" />Invite</button>
            <button onClick={() => navigator.clipboard?.writeText(url)} className="rounded-full bg-secondary p-2" aria-label="Copy link"><Copy className="h-4 w-4" /></button>
          </div>
        </div>
        {!isHost && <p className="text-xs text-muted-foreground">The host controls play and pause. Your video follows along automatically.</p>}
        {d.chatOn && <LiveChat chat={d.chat} onSend={async (name, msg) => { await partyChat({ data: { code, name, msg } }); q.refetch(); }} />}
        {d.state.type === "post"
          ? <Link to="/post/$id" params={{ id: String(d.state.id) }} className="text-sm text-primary underline">About this video</Link>
          : <Link to="/t/$type/$id" params={{ type: d.state.type, id: String(d.state.id) }} className="text-sm text-primary underline">About this title</Link>}
      </div>
    </Page>
  );
}
