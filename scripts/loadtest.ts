// Safe, progressive load test for LOOPGRAM's application API (cache-hit traffic by default).
// Usage: BASE=http://localhost:8080 bun scripts/loadtest.ts   (MAX=32 STEP_SECONDS=10 to adjust)
// It repeats a FIXED set of URLs, so after the first request each one is served from cache and
// TMDB is not flooded. Never point this at production without the owner's agreement; the
// per-IP rate limits (search 60/min, title 90/min, lists 120/min) will return 429s by design.
const BASE = process.env.BASE ?? "http://localhost:8080";
const MAX = Number(process.env.MAX ?? 16);
const STEP = Number(process.env.STEP_SECONDS ?? 5) * 1000;
const urls = [
  "/api/content?a=rows", "/api/content?a=feed&page=1", "/api/content?a=genres",
  "/api/content?a=discover&type=movie&sort=popularity.desc", "/api/content?a=game",
  "/api/content?a=calendar", "/api/content?a=search&q=batman", "/api/content?a=title&type=movie&id=550",
  "/api/content?a=title&type=tv&id=1399", "/api/content?a=person&id=287",
];
const pct = (s: number[], p: number) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;

for (let c = 1; c <= MAX; c *= 2) {
  const lat: number[] = []; const codes: Record<number, number> = {}; let errors = 0;
  const end = Date.now() + STEP;
  await Promise.all(Array.from({ length: c }, async (_, w) => {
    let i = w;
    while (Date.now() < end) {
      const t = performance.now();
      try {
        const r = await fetch(BASE + urls[i++ % urls.length], { signal: AbortSignal.timeout(10_000) });
        await r.arrayBuffer(); codes[r.status] = (codes[r.status] ?? 0) + 1;
      } catch { errors++; }
      lat.push(performance.now() - t);
    }
  }));
  lat.sort((x, y) => x - y);
  console.log(JSON.stringify({ concurrency: c, requests: lat.length, rps: +(lat.length / (STEP / 1000)).toFixed(1),
    p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1), p99: +pct(lat, 99).toFixed(1), errors, codes }));
  if (errors > lat.length * 0.05 || (codes[429] ?? 0) > 0) { console.log("Stopping: first bottleneck reached (errors or rate limit)."); break; }
}
