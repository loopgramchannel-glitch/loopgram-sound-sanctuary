// Loop Party storage. Redis first (fast, TTLs); when Redis is down or over its plan limit,
// everything falls back to DynamoDB (PK PARTY#<code>) so parties never stop working.
import { dynamo, redis, redisPipeline } from "./backend.server";

export const TTL = 6 * 3600;
const env = (k: string) => process.env[k] ?? "";
const table = () => env("DYNAMODB_TABLE_NAME");

let health = { up: true, until: 0 };
/** One PING per instance every 30s decides which store to use. */
export async function redisUp(): Promise<boolean> {
  if (Date.now() < health.until) return health.up;
  const r = await redis(["PING"]).catch(() => null);
  health = { up: r === "PONG", until: Date.now() + 30_000 };
  return health.up;
}
export function markRedisDown() { health = { up: false, until: Date.now() + 30_000 }; }

const sec = (ms = Date.now()) => Math.floor(ms / 1000);
const item = (pk: string, sk: string, d: string, ttl = TTL) => ({ PK: { S: pk }, SK: { S: sk }, d: { S: d }, exp: { N: String(sec() + ttl) } });
const alive = (it: any) => it && Number(it.exp?.N ?? 0) > sec();
async function dGet(pk: string, sk: string): Promise<string | null> {
  const r = await dynamo("GetItem", { TableName: table(), Key: { PK: { S: pk }, SK: { S: sk } }, ConsistentRead: true });
  return alive(r.Item) ? r.Item.d.S : null;
}
async function dQuery(pk: string, prefix: string, limit: number, desc = true): Promise<any[]> {
  const r = await dynamo("Query", {
    TableName: table(), KeyConditionExpression: "PK = :p AND begins_with(SK, :s)",
    ExpressionAttributeValues: { ":p": { S: pk }, ":s": { S: prefix } }, ScanIndexForward: !desc, Limit: limit,
  });
  return ((r.Items ?? []) as any[]).filter(alive);
}
async function dDelete(pk: string, sks: string[]) {
  for (let i = 0; i < sks.length; i += 25) {
    await dynamo("BatchWriteItem", { RequestItems: { [table()]: sks.slice(i, i + 25).map((sk) => ({ DeleteRequest: { Key: { PK: { S: pk }, SK: { S: sk } } } })) } });
  }
}

export async function getState(code: string): Promise<string | null> {
  if (await redisUp()) {
    const r = await redis(["GET", `party:${code}`]);
    if (typeof r === "string") return r;
  }
  return dGet(`PARTY#${code}`, "STATE").catch(() => null);
}

/** Saves state. With nx, fails if the code is already taken. */
export async function setState(code: string, json: string, nx = false): Promise<boolean> {
  if (await redisUp()) {
    const r = await redis(nx ? ["SET", `party:${code}`, json, "EX", TTL, "NX"] : ["SET", `party:${code}`, json, "EX", TTL]);
    if (r === "OK") return true;
    if (nx && r === null && (await redis(["EXISTS", `party:${code}`])) === 1) return false;
    markRedisDown();
  }
  try {
    await dynamo("PutItem", {
      TableName: table(), Item: item(`PARTY#${code}`, "STATE", json),
      ...(nx ? { ConditionExpression: "attribute_not_exists(PK) OR exp < :now", ExpressionAttributeValues: { ":now": { N: String(sec()) } } } : {}),
    });
    return true;
  } catch { return false; }
}

export type Chat = { n: string; m: string; t: number };
export async function addChat(code: string, c: Chat) {
  const json = JSON.stringify(c);
  if (await redisUp()) {
    const k = `party:${code}:chat`;
    const [r] = await redisPipeline([["LPUSH", k, json], ["LTRIM", k, 0, 99], ["EXPIRE", k, TTL]]);
    if (r != null) return;
    markRedisDown();
  }
  await dynamo("PutItem", { TableName: table(), Item: item(`PARTY#${code}`, `CHAT#${String(c.t).padStart(15, "0")}#${crypto.randomUUID().slice(0, 6)}`, json) });
}

/** Newest first. */
export async function getChat(code: string, n = 40): Promise<string[]> {
  if (await redisUp()) {
    const r = await redis(["LRANGE", `party:${code}:chat`, 0, n - 1]);
    if (Array.isArray(r) && r.length) return r as string[];
  }
  return (await dQuery(`PARTY#${code}`, "CHAT#", n).catch(() => [])).map((i) => i.d.S);
}

export async function ping(code: string, me: string) {
  if (await redisUp()) {
    const k = `party:${code}:here`;
    const [r] = await redisPipeline([["ZADD", k, Date.now(), me], ["ZREMRANGEBYSCORE", k, 0, Date.now() - 60_000], ["EXPIRE", k, TTL]]);
    if (r != null) return;
    markRedisDown();
  }
  await dynamo("PutItem", { TableName: table(), Item: item(`PARTY#${code}`, `HERE#${me}`, String(Date.now()), 120) });
}

export async function countHere(code: string): Promise<number> {
  if (await redisUp()) {
    const r = await redis(["ZCOUNT", `party:${code}:here`, Date.now() - 30_000, "+inf"]);
    if (r != null && Number(r) > 0) return Number(r);
  }
  const rows = await dQuery(`PARTY#${code}`, "HERE#", 1000).catch(() => []);
  return rows.filter((i) => Number(i.d.S) > Date.now() - 30_000).length;
}

export async function addActive(code: string) {
  if (await redisUp()) { if ((await redis(["ZADD", "party:active", Date.now(), code])) != null) return; markRedisDown(); }
  await dynamo("PutItem", { TableName: table(), Item: item("PARTIES", `P#${code}`, String(Date.now())) }).catch(() => null);
}

/** Open party codes, newest first, merged from both stores. */
export async function listActive(limit = 1000): Promise<string[]> {
  const out = new Set<string>();
  if (await redisUp()) {
    await redis(["ZREMRANGEBYSCORE", "party:active", 0, Date.now() - TTL * 1000]);
    const r = await redis(["ZREVRANGE", "party:active", 0, limit - 1]);
    if (Array.isArray(r)) r.forEach((c) => out.add(String(c)));
  }
  for (const i of await dQuery("PARTIES", "P#", limit).catch(() => [])) out.add(i.SK.S.slice(2));
  return [...out].slice(0, limit);
}

export async function endParty(code: string) {
  await redisPipeline([["DEL", `party:${code}`, `party:${code}:chat`, `party:${code}:here`], ["ZREM", "party:active", code]]).catch(() => null);
  const rows = await dQuery(`PARTY#${code}`, "", 1000).catch(() => []);
  await dDelete(`PARTY#${code}`, ["STATE", ...rows.map((i) => i.SK.S)]).catch(() => null);
  await dDelete("PARTIES", [`P#${code}`]).catch(() => null);
}

export async function clearChat(code: string) {
  await redis(["DEL", `party:${code}:chat`]).catch(() => null);
  const rows = await dQuery(`PARTY#${code}`, "CHAT#", 1000).catch(() => []);
  await dDelete(`PARTY#${code}`, rows.map((i) => i.SK.S)).catch(() => null);
}
