// Server-only clients: Upstash Redis, TMDB, DynamoDB, R2. Env read per call (Workers).
import { AwsClient } from "aws4fetch";
import { resolveTmdb } from "./tmdb-allowlist";

const env = (k: string) => process.env[k] ?? "";

// ---------- Redis (Upstash REST) ----------
// Circuit breaker (per isolate): after BREAK_AFTER consecutive failures, skip Redis for BREAK_MS so a
// down/over-quota Redis costs callers 0 ms instead of a 2.5 s timeout each. Callers already fail open.
const BREAK_AFTER = 3, BREAK_MS = 15_000;
let redisFails = 0, redisOpenUntil = 0;
export function redisCircuitOpen(now = Date.now()): boolean { return now < redisOpenUntil; }
export function redisRecord(ok: boolean, now = Date.now()): void {
  if (ok) { redisFails = 0; return; }
  if (++redisFails >= BREAK_AFTER) { redisOpenUntil = now + BREAK_MS; redisFails = 0; }
}
export function redisCircuitReset(): void { redisFails = 0; redisOpenUntil = 0; }

async function redisPost(path: string, body: unknown): Promise<Response | null> {
  const url = env("UPSTASH_REDIS_REST_URL"), token = env("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token || redisCircuitOpen()) return null;
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2500),
    });
    redisRecord(r.ok);
    return r.ok ? r : null;
  } catch { redisRecord(false); return null; }
}

export async function redis(cmd: (string | number)[]): Promise<unknown> {
  const r = await redisPost("", cmd);
  if (!r) return null;
  try { return ((await r.json()) as { result: unknown }).result; } catch { return null; }
}

/** Several commands in one HTTP round trip (Upstash /pipeline). Fails open with nulls. */
export async function redisPipeline(cmds: (string | number)[][]): Promise<unknown[]> {
  if (!cmds.length) return [];
  const r = await redisPost("/pipeline", cmds);
  if (!r) return cmds.map(() => null);
  try { return ((await r.json()) as { result?: unknown }[]).map((x) => x?.result ?? null); }
  catch { return cmds.map(() => null); }
}

/** Like redisPipeline, but reports whether every command really ran (no transport error, no quota/command error). */
export async function redisPipelineChecked(cmds: (string | number)[][]): Promise<{ ok: boolean; out: unknown[] }> {
  const fail = { ok: false, out: cmds.map(() => null) };
  if (!cmds.length) return fail;
  const r = await redisPost("/pipeline", cmds);
  if (!r) return fail;
  try {
    const j = (await r.json()) as { result?: unknown; error?: string }[];
    return { ok: j.every((x) => x && !x.error), out: j.map((x) => x?.result ?? null) };
  } catch { return fail; }
}

/** Fixed-window rate limit in one round trip; fails open if Redis is down. */
// Local tally per isolate: Redis is synced every SYNC_EVERY requests (batched INCRBY) instead of on
// every request, removing a Redis round trip from most API calls. Global count stays accurate within SYNC_EVERY.
const SYNC_EVERY = 10;
const rl = new Map<string, { pending: number; known: number }>();
export async function rateLimit(ip: string, limit = 120, windowSec = 60): Promise<boolean> {
  const key = `rl:${ip}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  let e = rl.get(key);
  if (!e) {
    if (rl.size > 5000) rl.clear();
    e = { pending: 0, known: 0 };
    rl.set(key, e);
  }
  e.pending++;
  if (e.known + e.pending > limit) return false;
  // Near the limit, sync every request so cross-instance overshoot shrinks to in-flight requests only.
  const nearLimit = e.known + e.pending > limit - SYNC_EVERY;
  if (!nearLimit && e.pending < SYNC_EVERY && e.known + e.pending > 1) return true;
  const inc = e.pending;
  e.pending = 0;
  const [n] = await redisPipeline([["INCRBY", key, inc], ["EXPIRE", key, windowSec, "NX"]]);
  if (typeof n === "number") e.known = n;
  else e.known += inc;
  return typeof n !== "number" || n <= limit;
}

// ---------- TMDB ----------
const inflight = new Map<string, Promise<TmdbResult>>();
// L1: per-isolate memory cache in front of Redis, so hot keys skip the Redis round trip.
// Same key as Redis (path + full query), so no cross-title/language contamination.
const L1_MAX = 400, L1_TTL_MS = 60_000;
const l1 = new Map<string, { body: string; exp: number }>();
function l1Get(key: string) {
  const e = l1.get(key);
  if (!e) return null;
  if (e.exp < Date.now()) { l1.delete(key); return null; }
  return e.body;
}
function l1Set(key: string, body: string, ttlSec: number) {
  if (l1.size >= L1_MAX) l1.delete(l1.keys().next().value as string);
  l1.set(key, { body, exp: Date.now() + Math.min(ttlSec * 1000, L1_TTL_MS) });
}
export type TmdbResult = { status: number; body: string; cache: "HIT" | "MISS" | "BYPASS" | "STALE"; ttl: number };

/** In-memory sliding-window limiter (per isolate). No network calls, so reads never depend on Redis. */
const sw = new Map<string, number[]>();
export function localRateLimit(key: string, limit = 120, windowMs = 60_000): boolean {
  const now = Date.now();
  if (sw.size > 10_000) sw.clear();
  const hits = (sw.get(key) ?? []).filter((t) => t > now - windowMs);
  if (hits.length >= limit) { sw.set(key, hits); return false; }
  hits.push(now);
  sw.set(key, hits);
  return true;
}

// Circuit breaker: after repeated 429/5xx/network failures, stop calling TMDB for a cool-down and serve stale copies.
const CB_THRESHOLD = 5, CB_COOLDOWN_MS = 30_000;
let cbFails = 0, cbOpenUntil = 0;
export const circuitOpen = () => Date.now() < cbOpenUntil;
function cbFail() { if (++cbFails >= CB_THRESHOLD) { cbOpenUntil = Date.now() + CB_COOLDOWN_MS; cbFails = 0; } }
function cbOk() { cbFails = 0; }
// Per-isolate last-good copies (survive Redis outages); bounded.
const memStale = new Map<string, string>();
function memStaleSet(key: string, body: string) {
  if (memStale.size >= 800) memStale.delete(memStale.keys().next().value as string);
  memStale.set(key, body);
}
const bg = (p: Promise<unknown>) => { p.catch(() => {}); };

// Owner's TMDB master switch (Studio → Announcements & Settings). Read from Redis, cached 15s; fails open (on).
let tmdbFlag: { on: boolean; exp: number } | null = null;
export async function tmdbEnabled(): Promise<boolean> {
  if (tmdbFlag && tmdbFlag.exp > Date.now()) return tmdbFlag.on;
  const raw = await (await import("./settings-store.server")).readSettingsRaw();
  let on = true;
  try { on = raw ? JSON.parse(raw).tmdbEnabled !== false : true; } catch { /* keep on */ }
  tmdbFlag = { on, exp: Date.now() + 15_000 };
  return on;
}
export function resetTmdbFlag() { tmdbFlag = null; }

const vault = () => import("./catalog.server");
async function vaultFallback(key: string): Promise<TmdbResult | null> {
  try {
    const v = await (await vault()).vaultGet(key);
    if (v) { memStaleSet(key, v); return { status: 200, body: v, cache: "STALE", ttl: 300 }; }
  } catch (e) { console.log(JSON.stringify({ flow: "vault", event: "read_failed", error: String(e).slice(0, 120) })); }
  return null;
}

/** The cache/database key tmdb() uses for a request (null when the request isn't allowed). */
export function tmdbKey(path: string, params: Record<string, string | number | undefined>): { key: string; path: string } | null {
  const input = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)] as [string, string]));
  const res = resolveTmdb(path, input);
  return res.ok ? { key: `tmdb:v1:${res.path}?${res.query.toString()}`, path: res.path } : null;
}

export async function tmdb(path: string, params: Record<string, string | number | undefined> | URLSearchParams = {}, opts: { fresh?: boolean } = {}): Promise<TmdbResult> {
  const input = params instanceof URLSearchParams ? params : new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)] as [string, string]));
  const res = resolveTmdb(path, input);
  if (!res.ok) return { status: res.status, body: JSON.stringify({ error: res.error }), cache: "BYPASS", ttl: 0 };
  const qs = res.query.toString();
  const key = `tmdb:v1:${res.path}?${qs}`;
  const hot = l1Get(key);
  if (hot !== null && !opts.fresh) return { status: 200, body: hot, cache: "HIT", ttl: res.ttl };
  const staleOf = async (): Promise<TmdbResult | null> => {
    const m = memStale.get(key);
    if (m) return { status: 200, body: m, cache: "STALE", ttl: 60 };
    // Last resort: the permanent DynamoDB vault (survives TMDB revocation and Redis loss).
    return vaultFallback(key);
  };
  // Owner switched TMDB off: keep serving everything we already saved.
  if (!(await tmdbEnabled())) {
    const cached = await redis(["GET", key]);
    if (typeof cached === "string") return { status: 200, body: cached, cache: "HIT", ttl: res.ttl };
    return (await staleOf()) ?? { status: 503, body: JSON.stringify({ error: "TMDB is switched off by the owner" }), cache: "BYPASS", ttl: 0 };
  }
  const existing = opts.fresh ? undefined : inflight.get(key);
  if (existing) return existing;
  const p = (async (): Promise<TmdbResult> => {
    // Shared cache lookup (fails open to null in 2.5s if Redis is down).
    // Background refresh (fresh) skips caches and the saved copy so TMDB is really asked.
    const [cached, neg] = opts.fresh ? [null, null] : await redisPipeline([["GET", key], ["GET", `neg:${key}`]]);
    if (typeof cached === "string") { l1Set(key, cached, res.ttl); memStaleSet(key, cached); return { status: 200, body: cached, cache: "HIT", ttl: res.ttl }; }
    if (typeof neg === "string") return { status: 404, body: neg, cache: "HIT", ttl: 0 };
    // Database first: a recently saved copy in DynamoDB is served instead of calling TMDB live.
    try {
      const saved = await (await vault()).vaultGetMeta(key);
      if (!opts.fresh && saved && Date.now() - saved.savedAt < Math.max(res.ttl * 4000, 6 * 3600_000)) {
        l1Set(key, saved.body, res.ttl); memStaleSet(key, saved.body);
        bg(redisPipeline([["SET", key, saved.body, "EX", res.ttl]]));
        return { status: 200, body: saved.body, cache: "HIT", ttl: res.ttl };
      }
    } catch { /* DynamoDB unavailable: continue to TMDB */ }
    // Breaker open: don't touch TMDB at all.
    if (circuitOpen()) {
      const s = await staleOf();
      return s ?? { status: 503, body: JSON.stringify({ error: "TMDB temporarily unavailable" }), cache: "BYPASS", ttl: 0 };
    }
    const token = env("TMDB_READ_ACCESS_TOKEN");
    const url = new URL(`https://api.themoviedb.org/3/${res.path}`);
    res.query.forEach((v, k) => url.searchParams.set(k, v));
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    else url.searchParams.set("api_key", env("TMDB_API_KEY"));
    let r: Response | null = null;
    try { r = await fetch(url, { headers, signal: AbortSignal.timeout(6000) }); } catch { r = null; }
    // One polite retry on rate-limit/5xx (honours Retry-After, capped) before counting a failure.
    if (!r || r.status === 429 || r.status >= 500) {
      const ra = Number(r?.headers.get("retry-after")) || 0;
      await new Promise((ok) => setTimeout(ok, Math.min(2000, ra ? ra * 1000 : 400 + Math.random() * 400)));
      try { r = await fetch(url, { headers, signal: AbortSignal.timeout(6000) }); } catch { r = null; }
    }
    if (!r || r.status === 429 || r.status >= 500) {
      // Fail fast (no retry storms): trip the breaker and serve the last good copy.
      cbFail();
      const s = await staleOf();
      if (s) return s;
      return { status: r ? 503 : 504, body: JSON.stringify({ error: "TMDB unavailable" }), cache: "BYPASS", ttl: 0 };
    }
    if (r.status === 401 || r.status === 403) {
      // Key revoked/invalid: open the breaker and serve saved data instead of erroring.
      cbFail(); cbFail(); cbFail(); cbFail(); cbFail();
      const s = await staleOf();
      if (s) return s;
    }
    cbOk();
    const body = await r.text();
    if (r.ok) {
      l1Set(key, body, res.ttl);
      memStaleSet(key, body);
      bg(redisPipeline([["SET", key, body, "EX", res.ttl]]));
      bg(vault().then((v) => v.vaultSave(key, res.path, body)));
    } else if (r.status === 404) {
      bg(redisPipeline([["SET", `neg:${key}`, body.slice(0, 500), "EX", 300]]));
    }
    console.log(JSON.stringify({ flow: "tmdb", path: res.path, status: r.status, cache: "MISS" }));
    return { status: r.status, body, cache: "MISS", ttl: res.ttl };
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

export async function tmdbJson<T = any>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const r = await tmdb(path, params);
  if (r.status !== 200) throw new Error(`TMDB ${r.status}: ${r.body.slice(0, 200)}`);
  return JSON.parse(r.body) as T;
}

// ---------- AWS / DynamoDB ----------
function aws() {
  return new AwsClient({
    accessKeyId: env("AWS_ACCESS_KEY_ID"), secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
    region: env("AWS_REGION") || "eu-north-1", service: "dynamodb",
  });
}
export async function dynamo(op: string, body: unknown) {
  const region = env("AWS_REGION") || "eu-north-1";
  const r = await aws().fetch(`https://dynamodb.${region}.amazonaws.com/`, {
    method: "POST",
    headers: { "X-Amz-Target": `DynamoDB_20120810.${op}`, "Content-Type": "application/x-amz-json-1.0" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`DynamoDB ${op} ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
let tableKey: { pk: string; sk: string | undefined } | null = null;
export async function tableSchema() {
  if (tableKey) return tableKey as { pk: string; sk: string | undefined };
  const d = await dynamo("DescribeTable", { TableName: env("DYNAMODB_TABLE_NAME") });
  const ks = d.Table.KeySchema as { AttributeName: string; KeyType: string }[];
  tableKey = { pk: ks.find((k) => k.KeyType === "HASH")!.AttributeName, sk: ks.find((k) => k.KeyType === "RANGE")?.AttributeName };
  return tableKey as { pk: string; sk: string | undefined };
}
/** Write-sharded counter key: a hot title's writes spread over VIEW_SHARDS items/partitions.
 * Shard 0 keeps the original key (`TITLE#<type>#<id>`) so existing counts stay valid; total = sum of shards. */
export const VIEW_SHARDS = 10;
export function viewShardKey(type: string, id: number, shard = Math.floor(Math.random() * VIEW_SHARDS)) {
  return shard === 0 ? `TITLE#${type}#${id}` : `TITLE#${type}#${id}#S${shard}`;
}
// Derived Redis popularity is batched per isolate: increments accumulate locally and are flushed with one
// pipelined ZINCRBY per title at most every POP_FLUSH_MS, so lg:popular/lg:meta writes don't scale 1:1 with views.
// Losing an unflushed batch only under-counts derived data; DynamoDB (below) stays the per-view durable record.
const POP_FLUSH_MS = 5_000, META_TTL_MS = 10 * 60_000;
const POP_KEEP = 5000;
const popPending = new Map<string, number>();
const metaWritten = new Map<string, number>();
const metaPending = new Map<string, string>();
let popLastFlush = 0;
async function flushPopular(force = false) {
  const now = Date.now();
  if (!force && now - popLastFlush < POP_FLUSH_MS) return;
  if (!popPending.size && !metaPending.size) return;
  popLastFlush = now;
  const cmds: (string | number)[][] = [...popPending].map(([k, n]) => ["ZINCRBY", "lg:popular", n, k]);
  if (metaPending.size) cmds.push(["HSET", "lg:meta", ...[...metaPending].flat()]);
  // Memory cap: keep only the top POP_KEEP titles in the hot ranking (DynamoDB keeps every count forever).
  cmds.push(["ZREMRANGEBYRANK", "lg:popular", 0, -(POP_KEEP + 1)]);
  popPending.clear(); metaPending.clear();
  if (metaWritten.size > 5000) metaWritten.clear();
  await redisPipeline(cmds);
}
/** Anonymous view counter: one atomic UpdateItem (ADD) per view on a random shard, no scans.
 * Returns whether the durable DynamoDB write succeeded; it never reports persistence that didn't happen. */
export async function countView(type: string, id: number, title: string, poster: string | null): Promise<{ durable: boolean }> {
  const member = `${type}:${id}`;
  popPending.set(member, (popPending.get(member) ?? 0) + 1);
  if ((metaWritten.get(member) ?? 0) < Date.now() - META_TTL_MS) {
    metaWritten.set(member, Date.now());
    metaPending.set(member, JSON.stringify({ title, poster }));
  }
  const pop = flushPopular();
  // Hot-title batching: per isolate, at most one DynamoDB write per title every VIEW_FLUSH_MS, carrying the
  // accumulated count (ADD n). A viral title costs ~1 write/5s/instance instead of 1 write per click.
  const n = (viewPending.get(member) ?? 0) + 1;
  viewPending.set(member, n);
  const now = Date.now();
  if (now - (viewLastFlush.get(member) ?? 0) < VIEW_FLUSH_MS) { await pop; return { durable: false }; }
  viewLastFlush.set(member, now);
  viewPending.delete(member);
  if (viewLastFlush.size > 5000) viewLastFlush.clear();
  try {
  const k = await tableSchema();
  const Key: Record<string, { S: string }> = { [k.pk]: { S: viewShardKey(type, id) } };
  if (k.sk) Key[k.sk] = { S: "STATS" };
  await dynamo("UpdateItem", {
    TableName: env("DYNAMODB_TABLE_NAME"), Key,
    UpdateExpression: "ADD #v :one SET #t = :t, #p = :p, #m = :m, #i = :i, #u = :u",
    ExpressionAttributeNames: { "#v": "views", "#t": "title", "#p": "poster", "#m": "media", "#i": "tmdb_id", "#u": "updated_at" },
    ExpressionAttributeValues: {
      ":one": { N: String(n) }, ":t": { S: title.slice(0, 200) }, ":p": poster ? { S: poster } : { NULL: true },
      ":m": { S: type }, ":i": { N: String(id) }, ":u": { S: new Date().toISOString() },
    },
  });
  await pop;
  return { durable: true };
  } catch (e) {
    viewPending.set(member, (viewPending.get(member) ?? 0) + n); // keep the count for the next flush
    console.error("dynamo countView", e instanceof Error ? e.message.slice(0, 200) : e);
    await pop;
    return { durable: false };
  }
}
const VIEW_FLUSH_MS = 5_000;
const viewPending = new Map<string, number>();
const viewLastFlush = new Map<string, number>();
/** Per-isolate throttle for side jobs triggered by views (e.g. search re-index): true at most once per window per key. */
const sideJobAt = new Map<string, number>();
export function onceEvery(key: string, ms: number): boolean {
  const now = Date.now();
  if (now - (sideJobAt.get(key) ?? 0) < ms) return false;
  if (sideJobAt.size > 5000) sideJobAt.clear();
  sideJobAt.set(key, now);
  return true;
}
/** Offline recovery: rebuild derived lg:popular/lg:meta from authoritative DynamoDB shards (sums every shard).
 * Uses a paginated Scan, so it must only run from an operator script, never on a request path. */
export async function rebuildPopularFromDynamo() {
  const totals = new Map<string, { n: number; title: string; poster: string | null }>();
  let start: unknown;
  do {
    const r = await dynamo("Scan", {
      TableName: env("DYNAMODB_TABLE_NAME"), ExclusiveStartKey: start,
      FilterExpression: "attribute_exists(#v) AND attribute_exists(#m) AND attribute_exists(#i)",
      ExpressionAttributeNames: { "#v": "views", "#m": "media", "#i": "tmdb_id" },
    });
    for (const it of r.Items ?? []) {
      const key = `${it.media.S}:${it.tmdb_id.N}`;
      const e = totals.get(key) ?? { n: 0, title: it.title?.S ?? "", poster: it.poster?.S ?? null };
      e.n += Number(it.views.N);
      totals.set(key, e);
    }
    start = r.LastEvaluatedKey;
  } while (start);
  const entries = [...totals];
  for (let i = 0; i < entries.length; i += 200) {
    const part = entries.slice(i, i + 200);
    await redisPipeline([
      ["ZADD", "lg:popular", ...part.flatMap(([k, e]) => [e.n, k])],
      ["HSET", "lg:meta", ...part.flatMap(([k, e]) => [k, JSON.stringify({ title: e.title, poster: e.poster })])],
    ]);
  }
  return entries.length;
}
let popCache: { data: { id: number; media_type: string | undefined; title: string; poster_path: string | null }[]; exp: number } | null = null;
export async function popularOnLoopgram(n = 20) {
  const now = Date.now();
  if (popCache && popCache.exp > now) return popCache.data;
  const ids = (await redis(["ZREVRANGE", "lg:popular", 0, n - 1])) as string[] | null;
  if (!ids?.length) return [];
  const metas = (await redis(["HMGET", "lg:meta", ...ids])) as (string | null)[] | null;
  const data = ids.map((k, i) => {
    const [media_type, id] = k.split(":");
    const m = metas?.[i] ? JSON.parse(metas[i]!) : {};
    return { id: Number(id), media_type, title: m.title, poster_path: m.poster };
  }).filter((x) => x.title);
  popCache = { data, exp: now + 30_000 };
  return data;
}

// ---------- R2 ----------
function r2() {
  return new AwsClient({
    accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    region: "auto", service: "s3",
  });
}
const SIZES = new Set(["w185", "w342", "w500", "w780"]);
/** Mirror a TMDB image into R2 once; returns public URL. */
export async function mirrorImage(size: string, file: string): Promise<string | null> {
  if (!SIZES.has(size) || !/^\/[A-Za-z0-9_-]{5,64}\.(jpg|png|webp)$/.test(file)) return null;
  const key = `tmdb/${size}${file}`;
  const pub = `${env("R2_PUBLIC_URL").replace(/\/$/, "")}/${key}`;
  const flag = `r2:${key}`;
  if ((await redis(["GET", flag])) === "1") return pub;
  const base = `${env("R2_ENDPOINT").replace(/\/$/, "")}/${env("R2_BUCKET_NAME")}/${key}`;
  const head = await r2().fetch(base, { method: "HEAD", signal: AbortSignal.timeout(4000) });
  if (head.ok) { await redis(["SET", flag, "1", "EX", 3 * 86400]); return pub; }
  const img = await fetch(`https://image.tmdb.org/t/p/${size}${file}`, { signal: AbortSignal.timeout(8000) });
  if (!img.ok) return null;
  const buf = await img.arrayBuffer();
  if (buf.byteLength > 2_000_000) return null;
  const put = await r2().fetch(base, {
    method: "PUT", body: buf,
    headers: { "Content-Type": img.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
  });
  if (!put.ok) throw new Error(`R2 PUT ${put.status}: ${(await put.text()).slice(0, 200)}`);
  await redis(["SET", flag, "1", "EX", 3 * 86400]);
  return pub;
}

/** Checks an owner file in R2: does it exist, and what do its first bytes say it is. */
export async function r2Probe(key: string): Promise<{ exists: boolean; head: Uint8Array | null }> {
  const url = `${env("R2_ENDPOINT").replace(/\/$/, "")}/${env("R2_BUCKET_NAME")}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const r = await r2().fetch(url, { headers: { Range: "bytes=0-63" }, signal: AbortSignal.timeout(5000) });
  if (r.status === 404) return { exists: false, head: null };
  if (!r.ok && r.status !== 206) throw new Error(`R2 probe ${r.status}`);
  return { exists: true, head: new Uint8Array(await r.arrayBuffer()) };
}

export function clientIp(req: Request) {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
}
