// Read-only TMDB v3 allow-list. Add a row to support a newly documented endpoint.
type Rule = { pattern: string; params: string[]; ttl: number };

const L = ["language"];
const LP = ["language", "page"];
const LPR = ["language", "page", "region"];
const DETAIL = ["language", "append_to_response"];
const IMG = ["language", "include_image_language"];
const VID = ["language", "include_video_language"];
const CHG = ["start_date", "end_date", "page"];
const H = 3600;

const DISCOVER_COMMON = [
  "language", "page", "sort_by", "include_adult", "watch_region", "with_watch_providers",
  "without_watch_providers", "with_watch_monetization_types", "with_genres", "without_genres",
  "with_keywords", "without_keywords", "with_companies", "without_companies",
  "with_original_language", "with_origin_country", "with_runtime.gte", "with_runtime.lte",
  "vote_average.gte", "vote_average.lte", "vote_count.gte", "vote_count.lte",
];
const DISCOVER_MOVIE = [
  ...DISCOVER_COMMON, "region", "certification", "certification.gte", "certification.lte",
  "certification_country", "include_video", "primary_release_year", "primary_release_date.gte",
  "primary_release_date.lte", "release_date.gte", "release_date.lte", "with_release_type",
  "year", "with_cast", "with_crew", "with_people",
];
const DISCOVER_TV = [
  ...DISCOVER_COMMON, "air_date.gte", "air_date.lte", "first_air_date_year", "first_air_date.gte",
  "first_air_date.lte", "include_null_first_air_dates", "screened_theatrically", "timezone",
  "with_networks", "with_status", "with_type",
];
const SEARCH = ["query", "page", "language", "include_adult"];

export const RULES: Rule[] = [
  { pattern: "configuration", params: [], ttl: 24 * H },
  { pattern: "configuration/countries", params: L, ttl: 24 * H },
  { pattern: "configuration/jobs", params: [], ttl: 24 * H },
  { pattern: "configuration/languages", params: [], ttl: 24 * H },
  { pattern: "configuration/primary_translations", params: [], ttl: 24 * H },
  { pattern: "configuration/timezones", params: [], ttl: 24 * H },
  { pattern: "certification/movie/list", params: [], ttl: 24 * H },
  { pattern: "certification/tv/list", params: [], ttl: 24 * H },
  { pattern: "genre/movie/list", params: L, ttl: 24 * H },
  { pattern: "genre/tv/list", params: L, ttl: 24 * H },
  { pattern: "watch/providers/regions", params: L, ttl: 24 * H },
  { pattern: "watch/providers/movie", params: ["language", "watch_region"], ttl: 24 * H },
  { pattern: "watch/providers/tv", params: ["language", "watch_region"], ttl: 24 * H },
  { pattern: "discover/movie", params: DISCOVER_MOVIE, ttl: H },
  { pattern: "discover/tv", params: DISCOVER_TV, ttl: H },
  { pattern: "find/:id", params: ["external_source", "language"], ttl: 24 * H },
  { pattern: "trending/:tmedia/:twindow", params: L.concat("page"), ttl: 30 * 60 },
  ...["movie", "tv", "person", "collection", "company", "keyword", "multi"].map((k) => ({
    pattern: `search/${k}`,
    params: k === "movie" ? [...SEARCH, "region", "year", "primary_release_year"]
      : k === "tv" ? [...SEARCH, "first_air_date_year", "year"] : SEARCH,
    ttl: 15 * 60,
  })),
  // movie lists
  { pattern: "movie/now_playing", params: LPR, ttl: H },
  { pattern: "movie/popular", params: LPR, ttl: H },
  { pattern: "movie/top_rated", params: LPR, ttl: 6 * H },
  { pattern: "movie/upcoming", params: LPR, ttl: H },
  { pattern: "movie/latest", params: [], ttl: 10 * 60 },
  { pattern: "movie/changes", params: CHG, ttl: H },
  { pattern: "movie/:id", params: DETAIL, ttl: 6 * H },
  ...["alternative_titles:country", "changes:" + CHG.join("|"), "credits:language", "external_ids:",
    "images:" + IMG.join("|"), "keywords:", "lists:language|page", "recommendations:language|page",
    "release_dates:", "reviews:language|page", "similar:language|page", "translations:",
    "videos:" + VID.join("|"), "watch/providers:"].map((s) => {
    const [sub, p] = s.split(":");
    return { pattern: `movie/:id/${sub}`, params: p ? p.split("|") : [], ttl: 6 * H };
  }),
  // tv lists
  { pattern: "tv/airing_today", params: ["language", "page", "timezone"], ttl: H },
  { pattern: "tv/on_the_air", params: ["language", "page", "timezone"], ttl: H },
  { pattern: "tv/popular", params: LP, ttl: H },
  { pattern: "tv/top_rated", params: LP, ttl: 6 * H },
  { pattern: "tv/latest", params: [], ttl: 10 * 60 },
  { pattern: "tv/changes", params: CHG, ttl: H },
  { pattern: "tv/:id", params: DETAIL, ttl: 6 * H },
  ...["aggregate_credits:language", "alternative_titles:", "changes:" + CHG.join("|"),
    "content_ratings:", "credits:language", "episode_groups:", "external_ids:",
    "images:" + IMG.join("|"), "keywords:", "lists:language|page", "recommendations:language|page",
    "reviews:language|page", "screened_theatrically:", "similar:language|page", "translations:",
    "videos:" + VID.join("|"), "watch/providers:"].map((s) => {
    const [sub, p] = s.split(":");
    return { pattern: `tv/:id/${sub}`, params: p ? p.split("|") : [], ttl: 6 * H };
  }),
  { pattern: "tv/:id/season/:n", params: DETAIL, ttl: 6 * H },
  ...["aggregate_credits:language", "changes:" + CHG.join("|"), "credits:language", "external_ids:",
    "images:" + IMG.join("|"), "translations:", "videos:" + VID.join("|"), "watch/providers:language"].map((s) => {
    const [sub, p] = s.split(":");
    return { pattern: `tv/:id/season/:n/${sub}`, params: p ? p.split("|") : [], ttl: 6 * H };
  }),
  { pattern: "tv/:id/season/:n/episode/:e", params: DETAIL, ttl: 6 * H },
  ...["credits:language", "external_ids:", "images:" + IMG.join("|"), "translations:",
    "videos:" + VID.join("|")].map((s) => {
    const [sub, p] = s.split(":");
    return { pattern: `tv/:id/season/:n/episode/:e/${sub}`, params: p ? p.split("|") : [], ttl: 6 * H };
  }),
  { pattern: "tv/episode_group/:gid", params: L, ttl: 6 * H },
  // people
  { pattern: "person/popular", params: LP, ttl: H },
  { pattern: "person/latest", params: [], ttl: 10 * 60 },
  { pattern: "person/changes", params: CHG, ttl: H },
  { pattern: "person/:id", params: DETAIL, ttl: 6 * H },
  ...["changes:" + CHG.join("|"), "combined_credits:language", "external_ids:", "images:",
    "movie_credits:language", "tagged_images:page", "translations:", "tv_credits:language"].map((s) => {
    const [sub, p] = s.split(":");
    return { pattern: `person/:id/${sub}`, params: p ? p.split("|") : [], ttl: 6 * H };
  }),
  { pattern: "collection/:id", params: L, ttl: 24 * H },
  { pattern: "collection/:id/images", params: IMG, ttl: 24 * H },
  { pattern: "collection/:id/translations", params: [], ttl: 24 * H },
  { pattern: "company/:id", params: [], ttl: 24 * H },
  { pattern: "company/:id/alternative_names", params: [], ttl: 24 * H },
  { pattern: "company/:id/images", params: [], ttl: 24 * H },
  { pattern: "network/:id", params: [], ttl: 24 * H },
  { pattern: "network/:id/alternative_names", params: [], ttl: 24 * H },
  { pattern: "network/:id/images", params: [], ttl: 24 * H },
  { pattern: "keyword/:id", params: [], ttl: 24 * H },
  { pattern: "keyword/:id/movies", params: ["include_adult", "language", "page"], ttl: 6 * H },
  { pattern: "list/:id", params: LP, ttl: H },
  { pattern: "review/:rid", params: [], ttl: 24 * H },
  { pattern: "credit/:rid", params: [], ttl: 24 * H },
];

const BLOCKED = new Set(["account", "authentication", "guest_session"]);
const NUM = /^\d{1,10}$/;
const SEG: Record<string, RegExp> = {
  ":id": NUM, ":n": NUM, ":e": NUM,
  ":gid": /^[a-f0-9]{24}$/, ":rid": /^[a-zA-Z0-9]{1,32}$/,
  ":tmedia": /^(all|movie|tv|person)$/, ":twindow": /^(day|week)$/,
};
// For find/:id external ids like tt1234567
SEG[":id_find"] = /^[A-Za-z0-9_-]{1,40}$/;

const APPEND_OK = /^[a-z_/]+$/;

export type Resolved =
  | { ok: true; path: string; query: URLSearchParams; ttl: number }
  | { ok: false; status: number; error: string };

export function resolveTmdb(rawPath: string, input: URLSearchParams): Resolved {
  const path = rawPath.replace(/^\/+|\/+$/g, "");
  if (!path || path.length > 200 || /[^A-Za-z0-9_\-/]/.test(path) || path.includes(".."))
    return { ok: false, status: 400, error: "Invalid path" };
  const parts = path.split("/");
  if (BLOCKED.has(parts[0]!)) return { ok: false, status: 403, error: "Account/authentication endpoints are not available in LoopgramChannel" };
  if (parts[0] === "movie" || parts[0] === "tv" || parts[0] === "person") {
    if (parts[2] === "account_states" || parts[2] === "rating") return { ok: false, status: 403, error: "Account endpoints are not available" };
  }
  for (const rule of RULES) {
    const rp = rule.pattern.split("/");
    if (rp.length !== parts.length) continue;
    let match = true;
    for (let i = 0; i < rp.length; i++) {
      const s = rp[i]!;
      if (s.startsWith(":")) {
        const re = rule.pattern.startsWith("find/") ? SEG[":id_find"] : SEG[s];
        if (!re || !re.test(parts[i]!)) { match = false; break; }
      } else if (s !== parts[i]) { match = false; break; }
    }
    if (!match) continue;
    const query = new URLSearchParams();
    for (const key of rule.params) {
      const v = input.get(key);
      if (v == null || v.length > 300) continue;
      if (key === "append_to_response") {
        const items = v.split(",").filter((x) => APPEND_OK.test(x)).slice(0, 20);
        if (items.length) query.set(key, items.join(","));
        continue;
      }
      query.set(key, v);
    }
    query.sort();
    return { ok: true, path, query, ttl: rule.ttl };
  }
  return { ok: false, status: 404, error: "Endpoint not in LoopgramChannel TMDB allow-list" };
}
