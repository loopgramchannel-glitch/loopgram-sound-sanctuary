// Permanent TMDB store in DynamoDB (Source A). Every validated TMDB answer is saved forever (no TTL).
// tmdb() reads it first on a Redis miss (database-first) and as the last fallback when TMDB is off/revoked/down.
import { dynamo } from "./backend.server";
import { catalogIdentity, mergeCatalog, shrinkTmdbBody, stripOwnerFields, validateTmdbBody, validateTmdbDetail } from "./catalog";

const table = () => process.env["DYNAMODB_TABLE_NAME"] || "LoopgramContent";
const vaultPk = (cacheKey: string) => `TMDB#${cacheKey}`;
// Per-isolate write throttle: re-save the same response at most every 6h (bounds DynamoDB writes under load).
const lastSaved = new Map<string, number>();
const SAVE_EVERY_MS = 6 * 3600_000;

export type SaveResult = "saved" | "rejected" | "throttled";

export async function vaultSave(cacheKey: string, path: string, body: string, opts: { force?: boolean; by?: string } = {}): Promise<SaveResult> {
  const now = Date.now();
  if (!opts.force && (lastSaved.get(cacheKey) ?? 0) > now - SAVE_EVERY_MS) return "throttled";
  if (lastSaved.size > 5000) lastSaved.clear();
  lastSaved.set(cacheKey, now);
  body = shrinkTmdbBody(body);
  const check = validateTmdbBody(body);
  const ident = catalogIdentity(path);
  const detail = check.ok && ident ? validateTmdbDetail(path, check.json as Record<string, unknown>) : { ok: true as const };
  const reason = !check.ok ? check.reason : !detail.ok ? detail.reason : null;
  if (reason) {
    console.log(JSON.stringify({ flow: "vault", event: "rejected", path, reason }));
    // Quarantine: kept apart from accepted records (separate PK, 30-day TTL), never served or indexed.
    await dynamo("PutItem", {
      TableName: table(),
      Item: {
        PK: { S: `QUARANTINE#tmdb#${cacheKey}`.slice(0, 1000) }, SK: { S: "LATEST" },
        source: { S: "tmdb" }, status: { S: "QUARANTINED" }, reason: { S: reason },
        path: { S: path.slice(0, 200) }, size: { N: String(body?.length ?? 0) },
        at: { N: String(now) }, by: { S: opts.by ?? "visitor-read" },
        expiresAt: { N: String(Math.floor(now / 1000) + 30 * 86400) },
      },
    }).catch(() => {});
    return "rejected";
  }
  let toStore = body;
  if (ident && check.ok) {
    // Detail records: merge with what we already have so a partial answer never erases good fields.
    const prev = await vaultGetMeta(cacheKey).catch(() => null);
    let prevJson: Record<string, unknown> | null = null;
    try { prevJson = prev ? JSON.parse(prev.body) : null; } catch { prevJson = null; }
    toStore = JSON.stringify(mergeCatalog(prevJson, stripOwnerFields(check.json as Record<string, unknown>)));
  }
  await dynamo("PutItem", {
    TableName: table(),
    Item: {
      PK: { S: vaultPk(cacheKey) },
      SK: { S: "RESPONSE" },
      source: { S: "tmdb" },
      path: { S: path.slice(0, 200) },
      body: { S: toStore },
      status: { S: "READY" },
      savedAt: { N: String(now) },
      savedBy: { S: opts.by ?? "visitor-read" },
      ...(ident ? { tmdbType: { S: ident.type }, tmdbId: { N: String(ident.id) } } : {}),
    },
  });
  return "saved";
}

export async function vaultGetMeta(cacheKey: string): Promise<{ body: string; savedAt: number } | null> {
  const r = await dynamo("GetItem", {
    TableName: table(),
    Key: { PK: { S: vaultPk(cacheKey) }, SK: { S: "RESPONSE" } },
    ProjectionExpression: "body, #s, savedAt",
    ExpressionAttributeNames: { "#s": "status" },
  });
  const item = r?.Item;
  if (!item || item.status?.S !== "READY" || typeof item.body?.S !== "string") return null;
  return { body: item.body.S, savedAt: Number(item.savedAt?.N ?? 0) };
}

export async function vaultGet(cacheKey: string): Promise<string | null> {
  return (await vaultGetMeta(cacheKey))?.body ?? null;
}
