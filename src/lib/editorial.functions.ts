// Editorial server functions: public read for the homepage + owner-only Studio reads/writes (requireOwner on every call).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Editorial, originalVideos, type EditorialT } from "./editorial";

const tok = z.object({ token: z.string().min(20).max(4096) });

async function owner(token: string) {
  const { requireOwner, AuthError } = await import("./auth.server");
  try { return await requireOwner(token); }
  catch (e) { if (e instanceof AuthError) throw new Error(`${e.status}: ${e.message}`); throw new Error("401: Could not verify session"); }
}

let pubCache: { v: EditorialT; exp: number } | null = null;
async function readEditorial(): Promise<EditorialT> {
  const { redis } = await import("./backend.server");
  const raw = (await redis(["GET", "site:editorial"])) as string | null;
  try { return Editorial.parse(raw ? JSON.parse(raw) : {}); } catch { return Editorial.parse({}); }
}

/** Public: what visitors see. Unpublished originals are never sent. Fails soft to an empty layout. */
export const getEditorial = createServerFn({ method: "GET" }).handler(async () => {
  if (pubCache && pubCache.exp > Date.now()) return pubCache.v;
  const ed = await readEditorial().catch(() => Editorial.parse({}));
  const v = { ...ed, originals: ed.originals.filter((o) => o.published) };
  pubCache = { v, exp: Date.now() + 15_000 };
  return v;
});

export const getOriginal = createServerFn({ method: "GET" }).inputValidator((d: unknown) => z.object({ id: z.string().max(64) }).parse(d)).handler(async ({ data }) => {
  const ed = await readEditorial().catch(() => Editorial.parse({}));
  return ed.originals.find((o) => o.id === data.id && o.published) ?? null;
});

export const studioEditorial = createServerFn({ method: "POST" }).inputValidator((d: unknown) => tok.parse(d)).handler(async ({ data }) => {
  await owner(data.token);
  return readEditorial();
});

export const studioEditorialSave = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tok.extend({ editorial: Editorial, what: z.string().max(60) }).parse(d))
  .handler(async ({ data }) => {
    const me = await owner(data.token);
    const { redis } = await import("./backend.server");
    const { audit } = await import("./auth.server");
    const base = (process.env["R2_PUBLIC_URL"] ?? "").replace(/\/$/, "");
    for (const o of data.editorial.originals) {
      // Full-length playback only from the owner's own R2 bucket.
      for (const v of originalVideos(o)) if (!base || !v.startsWith(base + "/")) throw new Error(`400: "${o.title}" video must be a file in your media bucket (${base || "R2 not configured"}).`);
    }
    const ok = (await redis(["SET", "site:editorial", JSON.stringify(data.editorial)])) === "OK";
    await audit(me, `editorial.${data.what}`, "site:editorial", ok ? "ok" : "failed");
    if (!ok) throw new Error("502: Could not save (Redis unavailable).");
    pubCache = null;
    return { ok: true };
  });

/** Owner title lookup: TMDB search plus whether a full-length file exists in R2. */
export const studioTitleSearch = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tok.extend({ q: z.string().trim().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    await owner(data.token);
    const { tmdbJson } = await import("./backend.server");
    const { findStream } = await import("./playback.server");
    const r = await tmdbJson<{ results: any[] }>("search/multi", { query: data.q, page: 1, include_adult: "false" });
    const items = (r.results ?? []).filter((x) => x.media_type === "movie" || x.media_type === "tv").slice(0, 12).map((x) => ({
      id: x.id as number, media_type: x.media_type as "movie" | "tv", title: (x.title ?? x.name ?? "Untitled") as string,
      poster_path: (x.poster_path ?? null) as string | null, date: (x.release_date ?? x.first_air_date ?? null) as string | null,
    }));
    const streams = await Promise.all(items.map((i) => findStream(i.media_type, i.id).catch(() => null)));
    return { items: items.map((i, k) => ({ ...i, stream: streams[k]?.kind ?? null })) };
  });

/** Real numbers only: LoopgramChannel view ranking (Redis, derived from DynamoDB), account count, audit volume. */
export const studioAnalytics = createServerFn({ method: "POST" }).inputValidator((d: unknown) => tok.parse(d)).handler(async ({ data }) => {
  await owner(data.token);
  const { redis } = await import("./backend.server");
  const { idt } = await import("./auth.server");
  const [top, titles, accounts, auditLen] = await Promise.all([
    redis(["ZREVRANGE", "lg:popular", 0, 24, "WITHSCORES"]).then((r) => (r as string[] | null) ?? []).catch(() => null),
    redis(["ZCARD", "lg:popular"]).then(Number).catch(() => null),
    idt<{ recordsCount?: string }>("accounts:query", { returnUserInfo: false }).then((r) => Number(r.recordsCount ?? 0)).catch(() => null),
    redis(["LLEN", "studio:audit"]).then(Number).catch(() => null),
  ]);
  let rows: { key: string; title: string; views: number }[] = [];
  if (top?.length) {
    const keys = top.filter((_, i) => i % 2 === 0);
    const metas = ((await redis(["HMGET", "lg:meta", ...keys]).catch(() => null)) as (string | null)[] | null) ?? [];
    rows = keys.map((k, i) => { let t = k; try { t = JSON.parse(metas[i] ?? "{}").title ?? k; } catch {} return { key: k, title: t, views: Number(top[i * 2 + 1]) }; });
  }
  return { top: top ? rows : null, titles, accounts, auditLen, totalViews: top ? rows.reduce((a, r) => a + r.views, 0) : null };
});
