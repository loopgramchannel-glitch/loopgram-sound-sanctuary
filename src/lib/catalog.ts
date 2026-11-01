// Pure validation / normalization / merge rules for TMDB catalogue data (Source A).
// No I/O here so it can be unit-tested; storage lives in catalog.server.ts.

export const MAX_VAULT_BYTES = 350_000; // stay well under DynamoDB's 400 KB item limit

/** Oversized answers (long-running shows with thousands of cast/crew) are trimmed to the most important
 * people so they fit one record instead of being refused. Small answers are returned unchanged. */
export function shrinkTmdbBody(body: string): string {
  if (typeof body !== "string" || new TextEncoder().encode(body).length <= MAX_VAULT_BYTES) return body;
  let o: Record<string, unknown>;
  try { o = JSON.parse(body); } catch { return body; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return body;
  for (const limit of [80, 40, 20]) {
    for (const k of ["credits", "aggregate_credits"]) {
      const c = o[k] as Record<string, unknown> | undefined;
      if (!c || typeof c !== "object") continue;
      for (const part of ["cast", "crew"]) {
        const list = c[part];
        if (Array.isArray(list)) c[part] = list.slice(0, limit).map((p) =>
          p && typeof p === "object" && Array.isArray((p as Record<string, unknown>)["roles"])
            ? { ...p, roles: ((p as Record<string, unknown>)["roles"] as unknown[]).slice(0, 2) }
            : p && typeof p === "object" && Array.isArray((p as Record<string, unknown>)["jobs"])
              ? { ...p, jobs: ((p as Record<string, unknown>)["jobs"] as unknown[]).slice(0, 2) } : p);
      }
    }
    const out = JSON.stringify(o);
    if (new TextEncoder().encode(out).length <= MAX_VAULT_BYTES) return out;
  }
  return JSON.stringify(o);
}

export type VaultCheck = { ok: true; json: unknown } | { ok: false; reason: string };

/** Structural gate: only well-formed, successful, reasonably sized TMDB JSON may be saved permanently. */
export function validateTmdbBody(body: string): VaultCheck {
  if (typeof body !== "string" || body.length === 0) return { ok: false, reason: "EMPTY" };
  if (new TextEncoder().encode(body).length > MAX_VAULT_BYTES) return { ok: false, reason: "TOO_LARGE" };
  let json: unknown;
  try { json = JSON.parse(body); } catch { return { ok: false, reason: "MALFORMED_JSON" }; }
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, reason: "NOT_OBJECT" };
  const o = json as Record<string, unknown>;
  if (o["success"] === false || "status_code" in o && o["success"] !== true && !("id" in o) && !("results" in o)) {
    return { ok: false, reason: "UPSTREAM_ERROR" };
  }
  if ("id" in o && !(Number.isInteger(o["id"]) && (o["id"] as number) > 0)) return { ok: false, reason: "BAD_ID" };
  if ("results" in o && !Array.isArray(o["results"])) return { ok: false, reason: "BAD_RESULTS" };
  return { ok: true, json };
}

/** Detail paths like `movie/123` or `tv/45` (optionally with appended sub-resources) → catalogue identity. */
export function catalogIdentity(path: string): { type: "movie" | "tv"; id: number } | null {
  const m = /^(movie|tv)\/(\d{1,10})$/.exec(path);
  if (!m) return null;
  const id = Number(m[2]!);
  return id > 0 ? { type: m[1]! as "movie" | "tv", id } : null;
}

/** Detail-record business rules: the answer must describe the title we asked for, with a usable name. */
export function validateTmdbDetail(path: string, json: Record<string, unknown>): { ok: true } | { ok: false; reason: string } {
  const ident = catalogIdentity(path);
  if (!ident) return { ok: true };
  if (json["id"] !== ident.id) return { ok: false, reason: "ID_MISMATCH" };
  const name = ident.type === "movie" ? json["title"] : json["name"];
  if (typeof name !== "string" || !name.trim() || name.length > 500) return { ok: false, reason: "MISSING_TITLE" };
  for (const k of ["overview", "poster_path", "backdrop_path", "release_date", "first_air_date"]) {
    const v = json[k];
    if (v !== undefined && v !== null && typeof v !== "string") return { ok: false, reason: `BAD_FIELD_${k.toUpperCase()}` };
  }
  for (const k of ["poster_path", "backdrop_path"]) {
    const v = json[k];
    if (typeof v === "string" && v && !/^\/[A-Za-z0-9._-]{1,200}$/.test(v)) return { ok: false, reason: "BAD_IMAGE_PATH" };
  }
  for (const k of ["release_date", "first_air_date"]) {
    const v = json[k];
    if (typeof v === "string" && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, reason: "BAD_DATE" };
  }
  const va = json["vote_average"];
  if (va !== undefined && va !== null && !(typeof va === "number" && Number.isFinite(va) && va >= 0 && va <= 10)) return { ok: false, reason: "BAD_RATING" };
  if (json["genres"] !== undefined && !Array.isArray(json["genres"])) return { ok: false, reason: "BAD_GENRES" };
  return { ok: true };
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) ||
  (typeof v === "number" && !Number.isFinite(v));

/** Merge policy: a refresh may add/update fields, but never replaces good existing data with empty values. */
export function mergeCatalog(existing: Record<string, unknown> | null, incoming: Record<string, unknown>) {
  if (!existing) return { ...incoming };
  const out: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (isEmpty(v) && !isEmpty(existing[k])) continue;
    out[k] = v;
  }
  return out;
}

/** Owner-controlled fields that a TMDB refresh must never touch. */
export const OWNER_FIELDS = ["ownerId", "streamKey", "customThumbnail", "ownerTitle", "ownerDescription", "status", "published"] as const;

export function stripOwnerFields(o: Record<string, unknown>) {
  const c = { ...o };
  for (const f of OWNER_FIELDS) delete c[f];
  return c;
}
