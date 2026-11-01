import { createFileRoute } from "@tanstack/react-router";
import { mirrorImage } from "@/lib/backend.server";

// Serves TMDB images via LoopgramChannel's R2 bucket (mirrored once), falling back to TMDB.
export const Route = createFileRoute("/api/media/img")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const s = u.searchParams.get("s") ?? "w342";
        const f = u.searchParams.get("f") ?? "";
        let target: string | null = null;
        try { target = await mirrorImage(s, f); } catch (e) { console.error(e); }
        if (!target) {
          if (!/^\/[A-Za-z0-9_-]{5,64}\.(jpg|png|webp)$/.test(f)) return new Response("Bad image", { status: 400 });
          target = `https://image.tmdb.org/t/p/${/^w(185|342|500|780)$/.test(s) ? s : "w342"}${f}`;
        }
        return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "public, max-age=86400, s-maxage=604800" } });
      },
    },
  },
});
