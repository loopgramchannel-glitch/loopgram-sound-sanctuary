// Browser-safe rules for where Studio uploads land in the owner's R2 bucket.
// TMDB-linked slots use the exact names findStream() looks for, so uploads play with no extra step.
import { z } from "zod";

export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_VIDEO_BYTES = 5 * 1024 ** 3; // R2 single-upload limit (5 GB)
export const MAX_IMAGE_BYTES = 15 * 1024 ** 2;

export const UploadTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("original-video") }),
  z.object({ kind: z.literal("image") }),
  z.object({ kind: z.literal("movie"), id: z.number().int().positive().max(1e10) }),
  z.object({ kind: z.literal("tv"), id: z.number().int().positive().max(1e10), season: z.number().int().min(0).max(500), episode: z.number().int().min(1).max(5000) }),
]);
export type UploadTargetT = z.infer<typeof UploadTarget>;

const EXT: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Returns the bucket key for an upload, or an error message when the file isn't allowed there. */
export function uploadKey(t: UploadTargetT, contentType: string, size: number, rand: string): { key: string } | { error: string } {
  const isVideo = (VIDEO_TYPES as readonly string[]).includes(contentType);
  const isImage = (IMAGE_TYPES as readonly string[]).includes(contentType);
  if (t.kind === "image") {
    if (!isImage) return { error: "Pictures must be JPG, PNG or WebP." };
    if (size > MAX_IMAGE_BYTES) return { error: "Pictures must be under 15 MB." };
    return { key: `media/images/${rand}.${EXT[contentType]}` };
  }
  if (!isVideo) return { error: "Videos must be MP4, WebM or MOV." };
  if (size > MAX_VIDEO_BYTES) return { error: "Videos must be under 5 GB." };
  if (t.kind === "original-video") return { key: `media/originals/${rand}.${EXT[contentType]}` };
  // Movie/TV slots: the player only looks for .mp4 under these names.
  if (contentType !== "video/mp4") return { error: "Movie and episode files must be MP4." };
  if (t.kind === "movie") return { key: `media/movie/${t.id}.mp4` };
  return { key: `media/tv/${t.id}/s${t.season}e${t.episode}.mp4` };
}

/** Only owner-uploaded files can be deleted from Studio; cached TMDB images are left alone. */
export const isDeletableKey = (k: string) => /^media\/[A-Za-z0-9/_.-]{1,400}$/.test(k) && !k.includes("..");
