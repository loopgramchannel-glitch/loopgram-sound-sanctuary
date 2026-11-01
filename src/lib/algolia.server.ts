// Server-only Algolia indexing. Uses the admin key; never import from browser code.
import { dynamo, redis, tableSchema, tmdbJson } from "./backend.server";
import { INDEX_SETTINGS, SEARCH_INDEX, POSTS_INDEX, POSTS_INDEX_SETTINGS, objectId, parseTitleKey, postRecord, toRecord, type PostRecord, type SearchJob, type SearchRecord } from "./search-index";

const RETRY_KEY = "lg:algolia:retry";

function creds() {
  const app = process.env["ALGOLIA_APP_ID"], key = process.env["ALGOLIA_ADMIN_API_KEY"];
  if (!app || !key) throw new Error("Algolia not configured (ALGOLIA_APP_ID / ALGOLIA_ADMIN_API_KEY missing)");
  return { app, key };
}
async function algolia(method: string, path: string, body?: unknown) {
  const { app, key } = creds();
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://${app}.algolia.net${path}`, {
        method, signal: AbortSignal.timeout(8000),
        headers: { "X-Algolia-Application-Id": app, "X-Algolia-API-Key": key, "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const t = await r.text();
      if (r.ok) return t ? JSON.parse(t) : {};
      last = `Algolia ${method} ${path.split("?")[0]} ${r.status}: ${t.slice(0, 200)}`;
      if (r.status < 500 && r.status !== 429) break; // permanent
    } catch (e) { last = e instanceof Error ? e.message : String(e); }
    await new Promise((res) => setTimeout(res, 200 * 2 ** attempt + Math.random() * 200));
  }
  throw new Error(last);
}
const idx = `/1/indexes/${encodeURIComponent(SEARCH_INDEX)}`;

export const applySettings = () => algolia("PUT", `${idx}/settings`, INDEX_SETTINGS);

async function buildRecord(type: "movie" | "tv", id: number, views = 0): Promise<SearchRecord | null> {
  try { return toRecord(type, await tmdbJson(`${type}/${id}`), views); }
  catch (e) { if (/TMDB 404/.test(String(e))) return null; throw e; }
}

/** Single job handler — the same entry point a future SQS consumer will call. Idempotent. */
export async function handleSearchJob(job: SearchJob): Promise<unknown> {
  if (job.kind === "reconcile") return reconcile();
  if (job.kind === "delete") return algolia("DELETE", `${idx}/${encodeURIComponent(objectId(job.type, job.id))}`);
  const rec = await buildRecord(job.type, job.id);
  if (!rec) return algolia("DELETE", `${idx}/${encodeURIComponent(objectId(job.type, job.id))}`);
  // partialUpdate keeps the `views` total maintained by reconcile; createIfNotExists for first sight.
  const { views: _v, ...rest } = rec;
  return algolia("POST", `${idx}/${encodeURIComponent(rec.objectID)}/partial?createIfNotExists=true`, rest);
}

/** Fire-and-forget from the view path: at most one index attempt per title per day (Redis lock). */
export async function enqueueIndex(type: "movie" | "tv", id: number) {
  const ok = await redis(["SET", `lg:algolia:seen:${type}:${id}`, "1", "NX", "EX", 86400]).catch(() => null);
  if (ok !== "OK") return; // already indexed recently (or Redis down: skip, reconcile catches up)
  // Prefer the background queue; if SQS is unavailable (e.g. missing permission) run inline.
  const { sendJob } = await import("./sqs.server");
  if (await sendJob({ kind: "index", type, id })) return;
  try { await handleSearchJob({ kind: "index", type, id }); }
  catch (e) {
    const { log } = await import("./log.server");
    log("error", "algolia.index_failed", { id: `${type}:${id}`, error: String(e) });
    await redis(["SADD", RETRY_KEY, `${type}:${id}`]).catch(() => {});
    await redis(["DEL", `lg:algolia:seen:${type}:${id}`]).catch(() => {});
  }
}

/** Retries titles whose indexing failed earlier. */
export async function retryFailed() {
  const members = ((await redis(["SMEMBERS", RETRY_KEY])) as string[] | null) ?? [];
  let ok = 0, failed = 0;
  for (const m of members.slice(0, 200)) {
    const [type, id] = m.split(":");
    try { await handleSearchJob({ kind: "index", type: type as "movie" | "tv", id: Number(id) }); await redis(["SREM", RETRY_KEY, m]); ok++; }
    catch { failed++; }
  }
  return { ok, failed, pending: members.length - ok };
}

/** Rebuilds the index from the authoritative DynamoDB titles into a temp index, then swaps it live.
 * Uses a paginated Scan, so it runs only from the protected sync endpoint, never a page request. */
export async function reconcile() {
  const totals = new Map<string, { type: "movie" | "tv"; id: number; views: number }>();
  const table = process.env["DYNAMODB_TABLE_NAME"];
  const k = await tableSchema();
  let start: unknown;
  do {
    const r = await dynamo("Scan", {
      TableName: table, ExclusiveStartKey: start, ProjectionExpression: "#pk, #v",
      ExpressionAttributeNames: { "#pk": k.pk, "#v": "views" },
    });
    for (const it of r.Items ?? []) {
      const p = parseTitleKey(it[k.pk]?.S ?? "");
      if (!p) continue;
      const key = objectId(p.type, p.id);
      const e = totals.get(key) ?? { ...p, views: 0 };
      e.views += Number(it.views?.N ?? 0);
      totals.set(key, e);
    }
    start = r.LastEvaluatedKey;
  } while (start);

  const records: SearchRecord[] = [];
  let skipped = 0;
  for (const t of totals.values()) {
    const rec = await buildRecord(t.type, t.id, t.views).catch(() => undefined);
    if (rec) records.push(rec); else skipped++;
  }
  const tmp = `${SEARCH_INDEX}_tmp`;
  const tmpPath = `/1/indexes/${encodeURIComponent(tmp)}`;
  await algolia("PUT", `${tmpPath}/settings`, INDEX_SETTINGS);
  for (let i = 0; i < records.length; i += 500) {
    await algolia("POST", `${tmpPath}/batch`, { requests: records.slice(i, i + 500).map((body) => ({ action: "updateObject", body })) });
  }
  const mv = await algolia("POST", `${tmpPath}/operation`, { operation: "move", destination: SEARCH_INDEX });
  // Wait for the swap so callers see the final state.
  for (let i = 0; i < 20 && mv.taskID; i++) {
    const s = await algolia("GET", `${tmpPath}/task/${mv.taskID}`);
    if (s.status === "published") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await redis(["DEL", RETRY_KEY]).catch(() => {});
  return { titles: totals.size, indexed: records.length, skipped };
}

// ---- Owner posts (Source B) ----
const pidx = `/1/indexes/${encodeURIComponent(POSTS_INDEX)}`;
const POST_RETRY = "lg:algolia:post-retry";

/** Upserts a PUBLISHED post or removes anything else. Same objectID every time → no duplicates. */
export async function syncPost(p: Parameters<typeof postRecord>[0], status: string) {
  const rec = postRecord(p, status);
  try {
    if (rec) await algolia("PUT", `${pidx}/${encodeURIComponent(rec.objectID)}`, rec);
    else await algolia("DELETE", `${pidx}/${encodeURIComponent(`post:${p.id}`)}`);
    await redis(["SREM", POST_RETRY, p.id]).catch(() => {});
    return rec ? "indexed" : "removed";
  } catch (e) {
    const { log } = await import("./log.server");
    log("error", "algolia.post_sync_failed", { id: p.id, error: String(e) });
    await redis(["SADD", POST_RETRY, p.id]).catch(() => {});
    return "failed";
  }
}
export const unindexPost = (id: string) => syncPost({ id, title: "", text: "", category: "", imageUrl: "", videoUrl: "", createdAt: 0 }, "DELETED");

/** Rebuilds the posts index from DynamoDB (the source of truth): published posts in, everything else out. */
export async function reconcilePosts() {
  const r = await dynamo("Query", {
    TableName: process.env["DYNAMODB_TABLE_NAME"],
    KeyConditionExpression: "PK = :p AND begins_with(SK, :s)",
    ExpressionAttributeValues: { ":p": { S: "OWNER#site" }, ":s": { S: "POST#" } },
  });
  const records: PostRecord[] = [];
  for (const it of r.Items ?? []) {
    try { const rec = postRecord(JSON.parse(it.body?.S ?? "{}"), it.status?.S ?? ""); if (rec) records.push(rec); } catch { /* skip bad row */ }
  }
  await algolia("PUT", `${pidx}/settings`, POSTS_INDEX_SETTINGS);
  await algolia("POST", `${pidx}/clear`);
  if (records.length) await algolia("POST", `${pidx}/batch`, { requests: records.map((body) => ({ action: "updateObject", body })) });
  await redis(["DEL", POST_RETRY]).catch(() => {});
  return { posts: (r.Items ?? []).length, indexed: records.length };
}
