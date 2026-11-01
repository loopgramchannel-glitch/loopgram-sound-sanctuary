import { createFileRoute } from "@tanstack/react-router";
import { tmdb, rateLimit, clientIp } from "@/lib/backend.server";

// Single controlled read-only gateway to TMDB v3.
export const Route = createFileRoute("/api/tmdb/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const rid = request.headers.get("x-request-id") ?? crypto.randomUUID();
        if (!(await rateLimit(clientIp(request), 200)))
          return Response.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": "60", "X-Request-Id": rid } });
        const url = new URL(request.url);
        const r = await tmdb(params._splat ?? "", url.searchParams);
        return new Response(r.body, {
          status: r.status,
          headers: {
            "Content-Type": "application/json",
            "X-Cache": r.cache,
            "X-Request-Id": rid,
            "Cache-Control": r.status === 200 ? `public, max-age=${Math.min(r.ttl, 600)}, s-maxage=${r.ttl}, stale-while-revalidate=86400` : "no-store",
          },
        });
      },
      POST: () => Response.json({ error: "Read-only gateway" }, { status: 405 }),
    },
  },
});
