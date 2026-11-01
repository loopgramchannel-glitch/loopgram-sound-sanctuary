// Browser-only: plays a Studio-uploaded post video as adaptive HLS when a converted copy exists in R2
// (made by scripts/transcode-hls.ts `post <videoUrl>`), otherwise the original file. Never throws.

/** media/originals/abc.mp4 → media/originals/abc/index.m3u8 ; null for anything not a Studio original. */
export function hlsFor(url: string): string | null {
  const m = /^(https:\/\/[^?#]+\/media\/originals\/[\w-]+)\.(mp4|mov|webm|m4v)(\?.*)?$/i.exec(url);
  return m ? `${m[1]}/index.m3u8` : null;
}

/** Attaches the best source to the element; returns a cleanup. */
export function attachSource(v: HTMLVideoElement, url: string): () => void {
  const hls = hlsFor(url);
  let dead = false, inst: { destroy: () => void } | null = null;
  const fallback = () => { if (dead) return; inst?.destroy(); inst = null; if (v.src !== url) { v.src = url; v.load(); } };
  if (!hls) { v.src = url; return () => { dead = true; }; }
  if (v.canPlayType("application/vnd.apple.mpegurl")) {
    const onErr = () => { v.removeEventListener("error", onErr); fallback(); };
    v.addEventListener("error", onErr);
    v.src = hls;
    return () => { dead = true; v.removeEventListener("error", onErr); };
  }
  import("hls.js").then(({ default: Hls }) => {
    if (dead) return;
    if (!Hls.isSupported()) return fallback();
    const h = new Hls({ manifestLoadingMaxRetry: 0, fragLoadingMaxRetry: 3, capLevelToPlayerSize: true });
    inst = h;
    h.on(Hls.Events.ERROR, (_e: unknown, d: { fatal?: boolean; type?: string }) => {
      if (!d?.fatal) return;
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR) h.recoverMediaError(); else fallback();
    });
    h.loadSource(hls);
    h.attachMedia(v);
  }).catch(fallback);
  return () => { dead = true; inst?.destroy(); };
}
