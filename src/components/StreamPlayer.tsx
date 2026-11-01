import { useEffect, useRef, useState } from "react";

const MAX_RETRIES = 3;
/** Bounded exponential backoff with jitter: ~1s, 2s, 4s (+0-500ms). */
export const backoff = (n: number) => Math.min(8000, 1000 * 2 ** n) + Math.floor(Math.random() * 500);

/** Plays a full-length video from the owner's R2 bucket (MP4 or HLS). hls.js is loaded only in the browser. */
export function StreamPlayer({ url, kind, title, poster, onFail }: { url: string; kind: "hls" | "mp4"; title: string; poster?: string | null; onFail: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "blocked" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const tries = useRef(0);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let hls: any, timer: any, dead = false;
    setState("loading");
    const retryOrFail = (permanent = false) => {
      if (dead) return;
      if (!permanent && tries.current < MAX_RETRIES) { timer = setTimeout(() => { tries.current++; setAttempt((a) => a + 1); }, backoff(tries.current)); return; }
      setState("error");
      console.warn("[playback] stream failed", { kind, attempts: tries.current });
    };
    const tryPlay = () => v.play().then(() => setState("ready")).catch((e) => setState(e?.name === "NotAllowedError" ? "blocked" : "ready"));
    v.addEventListener("canplay", tryPlay, { once: true });
    const onErr = () => retryOrFail(v.error?.code === 4); // MEDIA_ERR_SRC_NOT_SUPPORTED = permanent
    v.addEventListener("error", onErr);
    if (kind === "mp4" || v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = url; v.load();
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (dead) return;
        if (!Hls.isSupported()) { retryOrFail(true); return; }
        hls = new Hls({ manifestLoadingMaxRetry: 2, fragLoadingMaxRetry: 3 });
        hls.on(Hls.Events.ERROR, (_: unknown, d: any) => {
          if (!d?.fatal) return;
          if (d.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
          retryOrFail(d.response?.code === 404 || d.response?.code === 403);
        });
        hls.loadSource(url);
        hls.attachMedia(v);
      }).catch(() => retryOrFail());
    }
    return () => { dead = true; clearTimeout(timer); v.removeEventListener("canplay", tryPlay); v.removeEventListener("error", onErr); hls?.destroy(); v.removeAttribute("src"); v.load(); };
  }, [url, kind, attempt]);

  // Fit to the file's real proportions (landscape, portrait, square, anything): the box takes the video's own
  // aspect ratio, is capped to the screen width and 80% of its height, and object-contain never stretches or crops.
  const [ratio, setRatio] = useState(16 / 9);
  return (
    <div className="relative mx-auto w-full bg-black" style={ratio < 1 ? { height: `min(calc(100vw / ${ratio}), calc(100dvh - 3.5rem))` } : { aspectRatio: String(ratio), maxHeight: "80vh", maxWidth: `min(100%, calc(80vh * ${ratio}))` }}>
      <video ref={ref} controls playsInline autoPlay preload="auto" controlsList="nodownload" poster={poster ?? undefined} aria-label={title} className="absolute inset-0 h-full w-full object-contain"
        onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth > 0 && v.videoHeight > 0) setRatio(Math.min(4, Math.max(0.25, v.videoWidth / v.videoHeight))); }} />
      {state === "loading" && <div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-muted-foreground border-t-primary" aria-label="Loading video" /></div>}
      {state === "blocked" && (
        <button onClick={() => ref.current?.play().then(() => setState("ready")).catch(() => {})} className="absolute inset-0 grid place-items-center bg-background/40" aria-label={`Play ${title}`}>
          <span className="rounded-full bg-primary px-6 py-3 text-lg font-semibold text-primary-foreground">▶ Play</span>
        </button>
      )}
      {state === "error" && (
        <div className="absolute inset-0 grid place-items-center bg-background/90 p-4 text-center text-sm">
          <div>
            <p>This video couldn't load.</p>
            <div className="mt-3 flex justify-center gap-2">
              <button onClick={() => { tries.current = 0; setAttempt((a) => a + 1); }} className="rounded-full bg-primary px-4 py-1.5 text-primary-foreground">Try again</button>
              <button onClick={onFail} className="rounded-full bg-secondary px-4 py-1.5">Watch trailer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
