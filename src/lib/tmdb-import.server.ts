// Resumable TMDB → DynamoDB import. One step = one list page + its titles' full details.
// Runs from the background tick (once a minute site-wide) or the protected /api/public/jobs endpoint.
// Uses tmdb() only (allowlist, caching, breaker, rate limits); saves go through vaultSave() (validation + safe merge).
import { circuitOpen, dynamo, redis, tmdb, tmdbEnabled, tmdbKey } from "./backend.server";
import { vaultSave } from "./catalog.server";
import { IMPORT_LISTS, nextCursor, parseCursor, refreshDue, REFRESH_PAGES, titlesFromPage, type ImportCursor } from "./tmdb-import";
import { TITLE_APPEND } from "./title-append";
import { log } from "./log.server";

const table = () => process.env["DYNAMODB_TABLE_NAME"] || "LoopgramContent";
const CURSOR_KEY = "lg:import:cursor", STATS_KEY = "lg:import:stats", LOCK_KEY = "lg:import:lock";

export type StepResult = { ran: boolean; reason?: string; list?: string; page?: number; saved: number; rejected: number; duplicate: number; errors: number };

async function loadCursor(): Promise<ImportCursor> {
  const r = await redis(["GET", CURSOR_KEY]);
  if (typeof r === "string") return parseCursor(r);
  // Redis lost: resume from the durable copy.
  try {
    const d = await dynamo("GetItem", { TableName: table(), Key: { PK: { S: "IMPORT#tmdb" }, SK: { S: "STATE" } } });
    return parseCursor(d?.Item?.cursor?.S);
  } catch { return parseCursor(null); }
}

async function saveState(c: ImportCursor, add: Omit<StepResult, "ran" | "reason" | "list" | "page">) {
  await redis(["SET", CURSOR_KEY, JSON.stringify(c)]);
  for (const [k, v] of Object.entries(add)) if (v) await redis(["HINCRBY", STATS_KEY, k, v]);
  await dynamo("UpdateItem", {
    TableName: table(),
    Key: { PK: { S: "IMPORT#tmdb" }, SK: { S: "STATE" } },
    // `cursor`/`source` are DynamoDB reserved words, so they go through attribute-name placeholders.
    UpdateExpression: "SET #c = :c, updatedAt = :t, #s = :s ADD saved :a, rejected :r, duplicate :d, #e :e",
    ExpressionAttributeNames: { "#c": "cursor", "#s": "source", "#e": "errors" },
    ExpressionAttributeValues: {
      ":c": { S: JSON.stringify(c) }, ":t": { N: String(Date.now()) }, ":s": { S: "tmdb-import" },
      ":a": { N: String(add.saved) }, ":r": { N: String(add.rejected) }, ":d": { N: String(add.duplicate) }, ":e": { N: String(add.errors) },
    },
  }).catch((e) => log("warn", "import.state_save_failed", { error: String(e) }));
}

const transient = (s: number) => s === 429 || s >= 500;

export async function importStep(maxTitles = 20): Promise<StepResult> {
  const out: StepResult = { ran: false, saved: 0, rejected: 0, duplicate: 0, errors: 0 };
  if (!(await tmdbEnabled())) return { ...out, reason: "tmdb-off" };
  if (circuitOpen()) return { ...out, reason: "tmdb-cooling-down" };
  if ((await redis(["SET", LOCK_KEY, "1", "NX", "EX", 120])) !== "OK") return { ...out, reason: "already-running" };
  try {
    const c = await loadCursor();
    const list = IMPORT_LISTS[c.list]!;
    out.ran = true; out.list = list.path; out.page = c.page;
    const page = await tmdb(list.path, { page: c.page });
    if (page.status !== 200) {
      out.errors++;
      if (!transient(page.status)) await saveState(nextCursor(c, 0), out); // permanent: skip page
      else await saveState(c, out); // temporary: same page next time
      return out;
    }
    const lk = tmdbKey(list.path, { page: c.page });
    if (lk) await vaultSave(lk.key, lk.path, page.body, { force: true, by: "tmdb-import" }).catch(() => out.errors++);
    const json = JSON.parse(page.body);
    const titles = titlesFromPage(list.path, json).slice(0, maxTitles);
    let hadTransient = false;
    // Small concurrency keeps us far below TMDB's rate limits.
    for (let i = 0; i < titles.length; i += 4) {
      await Promise.all(titles.slice(i, i + 4).map(async ({ type, id }) => {
        const mark = `lg:import:done:r${c.round}:${type}:${id}`;
        if ((await redis(["SET", mark, "1", "NX", "EX", 30 * 86400])) !== "OK") { out.duplicate++; return; }
        const params = { append_to_response: TITLE_APPEND[type] };
        const r = await tmdb(`${type}/${id}`, params);
        if (r.status !== 200) {
          out.errors++;
          if (transient(r.status)) { hadTransient = true; await redis(["DEL", mark]); } // retry later
          return;
        }
        const k = tmdbKey(`${type}/${id}`, params)!;
        try {
          const s = await vaultSave(k.key, k.path, r.body, { force: true, by: "tmdb-import" });
          if (s === "saved") out.saved++; else if (s === "rejected") out.rejected++;
        } catch { out.errors++; await redis(["DEL", mark]); hadTransient = true; return; }
        const { enqueueIndex } = await import("./algolia.server");
        await enqueueIndex(type, id).catch(() => {});
      }));
    }
    await saveState(hadTransient ? c : nextCursor(c, Number(json.total_pages)), out);
    log("info", "import.step", { ...out });
    return out;
  } finally {
    await redis(["DEL", LOCK_KEY]);
  }
}

export async function importStatus() {
  const [cursor, stats] = await Promise.all([loadCursor(), redis(["HGETALL", STATS_KEY])]);
  const s: Record<string, number> = {};
  if (Array.isArray(stats)) for (let i = 0; i < stats.length; i += 2) s[String(stats[i])] = Number(stats[i + 1]);
  return { cursor: { ...cursor, list: IMPORT_LISTS[cursor.list]!.path }, stats: s };
}

// ---------- 3-hour refresh: re-pull the newest lists + their titles into the permanent store ----------
const REFRESH_KEY = "lg:refresh:state", REFRESH_LOCK = "lg:refresh:lock";
type RefreshState = { startedAt: number; next: number };

async function loadRefresh(): Promise<RefreshState> {
  const r = await redis(["GET", REFRESH_KEY]);
  try { if (typeof r === "string") return JSON.parse(r); } catch { /* fall through */ }
  try {
    const d = await dynamo("GetItem", { TableName: table(), Key: { PK: { S: "IMPORT#tmdb" }, SK: { S: "REFRESH" } } });
    if (d?.Item?.state?.S) return JSON.parse(d.Item.state.S);
  } catch { /* none */ }
  return { startedAt: 0, next: REFRESH_PAGES.length };
}
async function saveRefresh(s: RefreshState) {
  await redis(["SET", REFRESH_KEY, JSON.stringify(s)]);
  await dynamo("PutItem", {
    TableName: table(),
    Item: { PK: { S: "IMPORT#tmdb" }, SK: { S: "REFRESH" }, state: { S: JSON.stringify(s) }, updatedAt: { N: String(Date.now()) } },
  }).catch((e) => log("warn", "refresh.state_save_failed", { error: String(e) }));
}

/** One refresh step: every 3 hours a new round starts; each step re-pulls one list page and its titles (force-saved forever). */
export async function refreshStep(maxTitles = 20): Promise<StepResult> {
  const out: StepResult = { ran: false, saved: 0, rejected: 0, duplicate: 0, errors: 0 };
  if (!(await tmdbEnabled())) return { ...out, reason: "tmdb-off" };
  if (circuitOpen()) return { ...out, reason: "tmdb-cooling-down" };
  if ((await redis(["SET", REFRESH_LOCK, "1", "NX", "EX", 120])) !== "OK") return { ...out, reason: "already-running" };
  try {
    let st = await loadRefresh();
    if (st.next >= REFRESH_PAGES.length) {
      if (!refreshDue(st.startedAt, Date.now())) return { ...out, reason: "not-due" };
      st = { startedAt: Date.now(), next: 0 };
    }
    const item = REFRESH_PAGES[st.next]!;
    out.ran = true; out.list = item.path; out.page = item.page;
    const page = await tmdb(item.path, { page: item.page }, { fresh: true });
    // Served from a stale copy means TMDB is unreachable: keep position, retry next tick.
    if (page.status !== 200 || page.cache === "STALE") { out.errors++; await saveRefresh(st); return out; }
    const lk = tmdbKey(item.path, { page: item.page });
    if (lk) await vaultSave(lk.key, lk.path, page.body, { force: true, by: "tmdb-refresh" }).catch(() => out.errors++);
    const titles = titlesFromPage(item.path, JSON.parse(page.body)).slice(0, maxTitles);
    for (let i = 0; i < titles.length; i += 4) {
      await Promise.all(titles.slice(i, i + 4).map(async ({ type, id }) => {
        const mark = `lg:refresh:done:${st.startedAt}:${type}:${id}`;
        if ((await redis(["SET", mark, "1", "NX", "EX", 4 * 3600])) !== "OK") { out.duplicate++; return; }
        const params = { append_to_response: TITLE_APPEND[type] };
        const k = tmdbKey(`${type}/${id}`, params)!;
        const r = await tmdb(`${type}/${id}`, params, { fresh: true });
        if (r.status !== 200) { out.errors++; await redis(["DEL", mark]); return; }
        try {
          const s = await vaultSave(k.key, k.path, r.body, { force: true, by: "tmdb-refresh" });
          if (s === "saved") out.saved++; else if (s === "rejected") out.rejected++;
        } catch { out.errors++; await redis(["DEL", mark]); return; }
        const { enqueueIndex } = await import("./algolia.server");
        await enqueueIndex(type, id).catch(() => {});
      }));
    }
    await saveRefresh({ ...st, next: st.next + 1 });
    log("info", "refresh.step", { ...out });
    return out;
  } finally {
    await redis(["DEL", REFRESH_LOCK]);
  }
}
