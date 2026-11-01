// Loop Party live state. Redis first, DynamoDB fallback (party-store.server.ts) so parties keep working
// when Redis is down or over its plan limit. Load protection: per-isolate memo on hot reads,
// per-IP local rate limits on writes.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { makePartyCode, PARTY_CODE, postPartyMedia, type PartyState } from "./social";
import { YT_ID } from "./social";
import { LiveSettings, parseLive, partyAllowed, type LiveSettingsT } from "./live-settings";

const memo = new Map<string, { v: unknown; exp: number }>();
async function cached<T>(key: string, ms: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && hit.exp > Date.now()) return hit.v as T;
  const v = await fn();
  if (memo.size > 5000) memo.clear();
  memo.set(key, { v, exp: Date.now() + ms });
  return v;
}
async function guard(bucket: string, limit: number) {
  const { localRateLimit, clientIp } = await import("./backend.server");
  if (!localRateLimit(`${bucket}:${clientIp(getRequest())}`, limit)) throw new Error("Too many requests, slow down a little.");
}
const parse = <T,>(s: unknown): T | null => { try { return typeof s === "string" ? (JSON.parse(s) as T) : null; } catch { return null; } };
const Name = z.string().trim().min(1).max(24);
const Msg = z.string().trim().min(1).max(200);
type Chat = { n: string; m: string; t: number };
const store = () => import("./party-store.server");

// ---------- Owner live settings (Redis `site:live`, durable copy in DynamoDB OWNER#site / LIVE) ----------
async function readLive(): Promise<LiveSettingsT> {
  return cached("live", 5000, async () => {
    const { redis, dynamo } = await import("./backend.server");
    const raw = await redis(["GET", "site:live"]).catch(() => null);
    if (typeof raw === "string") return parseLive(parse(raw));
    const r = await dynamo("GetItem", { TableName: process.env["DYNAMODB_TABLE_NAME"], Key: { PK: { S: "OWNER#site" }, SK: { S: "LIVE" } } }).catch(() => null);
    return parseLive(parse(r?.Item?.d?.S));
  });
}
export const getLiveSettings = createServerFn({ method: "GET" }).handler(() => readLive().catch(() => parseLive({})));

const PartyIn = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tmdb"), video: z.string().regex(YT_ID), title: z.string().trim().max(200), type: z.enum(["movie", "tv"]), id: z.number().int().positive() }),
  z.object({ kind: z.literal("post"), id: z.string().regex(/^[a-z0-9-]{3,64}$/) }),
]);

export const createParty = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => PartyIn.parse(d))
  .handler(async ({ data }) => {
    await guard("pc", 10);
    const live = await readLive();
    if (!partyAllowed(live, data.kind)) throw new Error("Watch together is switched off for this right now.");
    const st = await store();
    const open = (await st.listActive(live.maxParties + 1)).length;
    if (open >= live.maxParties) throw new Error("All watch rooms are full right now. Please try again soon.");
    let base: Pick<PartyState, "video" | "file" | "title" | "type" | "id">;
    if (data.kind === "tmdb") {
      base = { video: data.video, title: data.title, type: data.type, id: data.id };
    } else {
      // Media comes from the owner's published post, never from the browser.
      const { readPosts } = await import("./posts.functions");
      const p = (await readPosts()).find((x) => x.id === data.id && x.published);
      const media = p ? postPartyMedia(p.videoUrl ?? "") : null;
      if (!p || !media) throw new Error("This video can't be watched together.");
      base = { ...media, title: (p.title || "Video").slice(0, 200), type: "post", id: p.id };
    }
    const hostKey = crypto.randomUUID();
    for (let i = 0; i < 5; i++) {
      const code = makePartyCode();
      const s: PartyState = { ...base, playing: false, pos: 0, at: Date.now(), v: 1 };
      if (await st.setState(code, JSON.stringify({ ...s, hostKey }), true)) {
        await st.addActive(code);
        return { code, hostKey };
      }
    }
    throw new Error("Could not start a party right now. Please try again.");
  });

// ---------- Studio (owner only) ----------
const tok = z.object({ token: z.string().min(20).max(4096) });
async function owner(token: string) {
  const { requireOwner, AuthError } = await import("./auth.server");
  try { return await requireOwner(token); }
  catch (e) { if (e instanceof AuthError) throw new Error(`${e.status}: ${e.message}`); throw new Error("401: Could not verify session"); }
}

export const studioLive = createServerFn({ method: "POST" }).inputValidator((d: unknown) => tok.parse(d)).handler(async ({ data }) => {
  await owner(data.token);
  memo.delete("live");
  const settings = await readLive();
  const st = await store();
  const codes = await st.listActive(50);
  const parties = (await Promise.all(codes.map(async (code) => {
    const p = parse<PartyState>(await st.getState(code));
    return p ? { code, title: p.title, type: p.type, id: String(p.id), playing: p.playing, people: await st.countHere(code) } : null;
  }))).filter(Boolean) as { code: string; title: string; type: string; id: string; playing: boolean; people: number }[];
  return { settings, parties };
});

export const studioLiveSave = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tok.extend({ settings: LiveSettings }).parse(d))
  .handler(async ({ data }) => {
    const me = await owner(data.token);
    const { redis, dynamo } = await import("./backend.server");
    const { audit } = await import("./auth.server");
    const json = JSON.stringify(parseLive(data.settings));
    await dynamo("PutItem", { TableName: process.env["DYNAMODB_TABLE_NAME"], Item: { PK: { S: "OWNER#site" }, SK: { S: "LIVE" }, d: { S: json } } });
    const ok = await redis(["SET", "site:live", json]).catch(() => null);
    if (ok !== "OK") await redis(["DEL", "site:live"]).catch(() => null);
    memo.delete("live");
    await audit(me, "live.settings", "site:live", "ok");
    return { ok: true };
  });

export const studioEndParty = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tok.extend({ code: z.string().regex(PARTY_CODE) }).parse(d))
  .handler(async ({ data }) => {
    const me = await owner(data.token);
    const { audit } = await import("./auth.server");
    await (await store()).endParty(data.code);
    memo.delete(`p:${data.code}`);
    await audit(me, "live.party.end", data.code, "ok");
    return { ok: true };
  });

export const studioClearChat = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tok.extend({ code: z.string().regex(PARTY_CODE) }).parse(d))
  .handler(async ({ data }) => {
    const me = await owner(data.token);
    const { audit } = await import("./auth.server");
    await (await store()).clearChat(data.code);
    memo.delete(`p:${data.code}`);
    await audit(me, "live.party.clearChat", data.code, "ok");
    return { ok: true };
  });

export const studioEndAll = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tok.parse(d))
  .handler(async ({ data }) => {
    const me = await owner(data.token);
    const { audit } = await import("./auth.server");
    const st = await store();
    const codes = await st.listActive(1000);
    for (const c of codes) await st.endParty(c);
    memo.clear();
    await audit(me, "live.party.endAll", String(codes.length), "ok");
    return { ended: codes.length };
  });

export const getParty = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ code: z.string().regex(PARTY_CODE) }).parse(d))
  .handler(async ({ data }) => cached(`p:${data.code}`, 800, async () => {
    const st = await store();
    const p = parse<PartyState & { hostKey?: string }>(await st.getState(data.code));
    if (!p) return null;
    const live = await readLive();
    if (!partyAllowed(live, p.type === "post" ? "post" : "tmdb")) return null;
    const [chat, people] = await Promise.all([live.partyChat ? st.getChat(data.code, 40) : Promise.resolve([]), st.countHere(data.code)]);
    delete p.hostKey;
    return { state: p as PartyState, chatOn: live.partyChat, chat: chat.map((c) => parse<Chat>(c)).filter(Boolean).reverse() as Chat[], people, now: Date.now() };
  }));

export const controlParty = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ code: z.string().regex(PARTY_CODE), hostKey: z.string().uuid(), playing: z.boolean(), pos: z.number().min(0).max(86400) }).parse(d))
  .handler(async ({ data }) => {
    await guard("px", 120);
    const st = await store();
    const p = parse<PartyState & { hostKey: string }>(await st.getState(data.code));
    if (!p || p.hostKey !== data.hostKey) throw new Error("Only the host can control playback.");
    const next = { ...p, playing: data.playing, pos: data.pos, at: Date.now(), v: p.v + 1 };
    if (!(await st.setState(data.code, JSON.stringify(next)))) throw new Error("Couldn't update the party, try again.");
    memo.delete(`p:${data.code}`);
    return { ok: true };
  });

export const partyPing = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ code: z.string().regex(PARTY_CODE), me: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await guard("pp", 30);
    await (await store()).ping(data.code, data.me).catch(() => null);
    return { ok: true };
  });

export const partyChat = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ code: z.string().regex(PARTY_CODE), name: Name, msg: Msg }).parse(d))
  .handler(async ({ data }) => {
    await guard("pm", 20);
    if (!(await readLive()).partyChat) throw new Error("Chat is switched off.");
    await (await store()).addChat(data.code, { n: data.name, m: data.msg, t: Date.now() });
    memo.delete(`p:${data.code}`);
    return { ok: true };
  });
