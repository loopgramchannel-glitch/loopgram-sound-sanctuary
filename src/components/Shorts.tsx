// YouTube-Shorts style pieces: vertical 9:16 cards and the full-screen vertical player.
import { attachSource } from "@/lib/hls-attach";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Home, Pause, Play, Share2, ThumbsDown, ThumbsUp, Volume2, VolumeX, X } from "lucide-react";
import type { PostT } from "@/lib/posts";
import { PostThumb } from "@/components/PostView";
import { parseVideoSource } from "@/lib/video-source";
import { formatCount, viewsLabel } from "@/lib/post-stats";
import { usePostEngagement } from "@/lib/use-post-stats";

export function ShortsMark({ className = "" }: { className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary-foreground ${className}`}><Play className="h-2.5 w-2.5 fill-current" />Shorts</span>;
}

export function ShortTile({ post, className = "w-40 sm:w-48" }: { post: PostT; className?: string }) {
  const title = post.title || post.text.slice(0, 80) || "Short";
  return (
    <Link to="/post/$id" params={{ id: post.id }} className={`group relative block shrink-0 overflow-hidden rounded-xl bg-black ${className}`}>
      <PostThumb post={post} fill className="aspect-[9/16] w-full transition-transform group-hover:scale-[1.03]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 pt-10">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white">{title}</h3>
      </div>
    </Link>
  );
}

export function ShortsShelf({ posts }: { posts: PostT[] }) {
  if (!posts.length) return null;
  return (
    <section className="py-3">
      <h2 className="flex items-center gap-2 px-4 text-lg font-bold"><ShortsMark />Shorts</h2>
      <div className="scrollbar-none mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
        {posts.map((p) => <ShortTile key={p.id} post={p} />)}
      </div>
    </section>
  );
}

/** YouTube-Shorts feed: native scroll-snap (finger-tracking, momentum, mouse wheel), neighbours pre-buffered, URL synced without reload. */
export function ShortsPlayer({ shorts, startId, onShare }: { shorts: PostT[]; startId: string; onShare: (p: PostT) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => Math.max(0, shorts.findIndex((p) => p.id === startId)));
  const [muted, setMuted] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);
  // Keep the address bar on the visible Short, but only after the swipe settles.
  useEffect(() => {
    const t = setTimeout(() => {
      const p = shorts[active];
      if (p && location.pathname !== `/post/${p.id}`) history.replaceState(history.state, "", `/post/${p.id}`);
    }, 400);
    return () => clearTimeout(t);
  }, [active, shorts]);

  // YouTube-style pager: the track follows the finger 1:1 (no React re-render while dragging);
  // a short fast flick or a drag past 18% of the screen moves exactly one Short.
  const track = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const place = (offset: number, animate: boolean) => {
    const t = track.current; if (!t) return;
    t.style.transition = animate ? "transform 260ms cubic-bezier(0.22, 0.9, 0.25, 1)" : "none";
    t.style.transform = `translate3d(0, calc(${-activeRef.current * 100}dvh + ${offset}px), 0)`;
  };
  const goTo = (i: number) => {
    const n = Math.min(shorts.length - 1, Math.max(0, i));
    activeRef.current = n; setActive(n); place(0, true);
  };
  useEffect(() => { place(0, false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { place(0, true); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = box.current; if (!el) return;
    let y0 = 0, x0 = 0, t0 = 0, dy = 0, dragging = false, decided = false, lastY = 0, lastT = 0, vel = 0;
    const start = (e: TouchEvent) => {
      const p = e.touches[0]; if (!p) return; y0 = lastY = p.clientY; x0 = p.clientX; t0 = lastT = performance.now();
      dy = 0; vel = 0; dragging = false; decided = false;
    };
    const move = (e: TouchEvent) => {
      const p = e.touches[0]; if (!p) return; const ddy = p.clientY - y0;
      if (!decided) {
        if (Math.abs(ddy) < 6 && Math.abs(p.clientX - x0) < 6) return;
        decided = true; dragging = Math.abs(ddy) > Math.abs(p.clientX - x0);
      }
      if (!dragging) return;
      e.preventDefault();
      const now = performance.now();
      vel = (p.clientY - lastY) / Math.max(1, now - lastT); lastY = p.clientY; lastT = now;
      const a = activeRef.current;
      const atEdge = (a === 0 && ddy > 0) || (a === shorts.length - 1 && ddy < 0);
      dy = atEdge ? ddy * 0.3 : ddy;
      place(dy, false);
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      const h = el.clientHeight; const a = activeRef.current;
      const fast = Math.abs(vel) > 0.35 || (Math.abs(dy) > 30 && performance.now() - t0 < 220);
      if ((fast || Math.abs(dy) > h * 0.18) && dy < 0) goTo(a + 1);
      else if ((fast || Math.abs(dy) > h * 0.18) && dy > 0) goTo(a - 1);
      else place(0, true);
    };
    let wheelLock = 0;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = performance.now();
      if (now < wheelLock || Math.abs(e.deltaY) < 12) return;
      wheelLock = now + 450;
      goTo(activeRef.current + (e.deltaY > 0 ? 1 : -1));
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end); el.addEventListener("touchcancel", end);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", start); el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end); el.removeEventListener("touchcancel", end);
      el.removeEventListener("wheel", wheel);
    };
  }, [shorts.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "ArrowDown") { e.preventDefault(); goTo(active + 1); } if (e.key === "ArrowUp") { e.preventDefault(); goTo(active - 1); } if (e.key === "Escape") navigate({ to: "/posts" }); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  return (
    <div className="fixed inset-0 z-[60] bg-black">
      <div ref={box} className="h-dvh touch-none overflow-hidden overscroll-none">
        <div ref={track} className="will-change-transform">
          {shorts.map((p, i) => (
            <div key={p.id} className="relative flex h-dvh w-full items-center justify-center overflow-hidden [contain:strict]">
              {Math.abs(i - active) <= 2
                ? <ShortSlide post={p} active={i === active} muted={muted} setMuted={setMuted} onShare={() => onShare(p)} />
                : null}
            </div>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <Link to="/posts" aria-label="Back to videos" className="flex h-11 items-center gap-1 rounded-full bg-black/50 pl-2 pr-4 text-sm font-semibold text-white backdrop-blur hover:bg-black/70"><ArrowLeft className="h-6 w-6" />Back</Link>
          <Link to="/" aria-label="Home" className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white backdrop-blur hover:bg-black/70"><Home className="h-5 w-5" /></Link>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <button onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"} className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white backdrop-blur">{muted ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}</button>
          <Link to="/posts" aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white backdrop-blur hover:bg-black/70"><X className="h-6 w-6" /></Link>
        </div>
      </div>

      <div className="absolute right-6 top-1/2 z-10 hidden -translate-y-1/2 flex-col gap-3 sm:flex">
        <button disabled={active === 0} onClick={() => goTo(active - 1)} aria-label="Previous short" className="grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white disabled:opacity-30"><ChevronUp className="h-6 w-6" /></button>
        <button disabled={active >= shorts.length - 1} onClick={() => goTo(active + 1)} aria-label="Next short" className="grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white disabled:opacity-30"><ChevronDown className="h-6 w-6" /></button>
      </div>
    </div>
  );
}

function ShortSlide({ post, active, muted, setMuted, onShare }: { post: PostT; active: boolean; muted: boolean; setMuted: (m: boolean) => void; onShare: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [more, setMore] = useState(false);
  const eng = usePostEngagement(post.id, true, active);
  const src = parseVideoSource(post.videoUrl);

  useEffect(() => { const v = ref.current; if (!v || src.embed) return; return attachSource(v, post.videoUrl); }, [post.videoUrl, src.embed]);
  useEffect(() => {
    const v = ref.current; if (!v) return;
    if (!active) { v.pause(); return; }
    v.currentTime = 0; setPaused(false);
    v.muted = muted;
    v.play().catch(() => { v.muted = true; setMuted(true); v.play().catch(() => setPaused(true)); });
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ref.current) ref.current.muted = muted; }, [muted]);

  const toggle = () => { const v = ref.current; if (!v) return; if (v.paused) { v.play(); setPaused(false); } else { v.pause(); setPaused(true); } };
  const rail = "flex flex-col items-center gap-1 text-xs font-medium text-white";
  const btn = "grid h-12 w-12 place-items-center rounded-full bg-white/15 backdrop-blur hover:bg-white/25";

  return (
    <div className="relative h-full w-full sm:aspect-[9/16] sm:w-auto sm:max-w-full sm:overflow-hidden sm:rounded-xl">
      {src.embed ? (
        active ? <iframe src={src.embed} title={post.title || "Short"} className="absolute inset-0 h-full w-full border-0" allowFullScreen
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share" referrerPolicy="strict-origin-when-cross-origin" />
          : <PostThumb post={post} className="absolute inset-0 h-full w-full" />
      ) : (
        <>
          {post.imageUrl && <img src={post.imageUrl} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl" />}
          <video ref={ref} poster={post.imageUrl || undefined} playsInline loop preload="auto" muted={muted}
            onClick={toggle} className="absolute inset-0 h-full w-full object-contain" />
        </>
      )}
      {paused && !src.embed && <button onClick={toggle} aria-label="Play" className="absolute inset-0 grid place-items-center"><span className="grid h-20 w-20 place-items-center rounded-full bg-black/50 text-white"><Play className="ml-1 h-10 w-10 fill-current" /></span></button>}

      <div className="absolute bottom-24 right-2 flex flex-col items-center gap-4 sm:bottom-6">
        <button onClick={() => eng.tap(1)} aria-pressed={eng.vote === 1} className={rail}><span className={btn}><ThumbsUp className={`h-6 w-6 ${eng.vote === 1 ? "fill-current" : ""}`} /></span>{eng.likes ? formatCount(eng.likes) : "Like"}</button>
        <button onClick={() => eng.tap(-1)} aria-pressed={eng.vote === -1} className={rail}><span className={btn}><ThumbsDown className={`h-6 w-6 ${eng.vote === -1 ? "fill-current" : ""}`} /></span>Dislike</button>
        <button onClick={onShare} className={rail}><span className={btn}><Share2 className="h-6 w-6" /></span>Share</button>
        {!src.embed && <button onClick={toggle} className={rail}><span className={btn}>{paused ? <Play className="h-6 w-6" /> : <Pause className="h-6 w-6" />}</span>{paused ? "Play" : "Pause"}</button>}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-4 pr-20 pt-16">
        <div className="pointer-events-auto flex items-center gap-2">
          <img src="/icon.svg" alt="" className="h-8 w-8 rounded-full bg-white/20 p-1" />
          <span className="text-sm font-semibold text-white">@LoopgramChannel</span>
        </div>
        <button onClick={() => setMore((m) => !m)} className="pointer-events-auto mt-2 block text-left text-sm text-white">
          <span className="font-semibold">{post.title || "Short"}</span>{eng.views > 0 && <span className="ml-2 text-white/75">{viewsLabel(eng.views)}</span>}
          {post.text && <span className={`mt-1 block whitespace-pre-line text-white/85 ${more ? "max-h-[40vh] overflow-y-auto" : "line-clamp-2"}`}>{post.text}</span>}
        </button>
      </div>
    </div>
  );
}
