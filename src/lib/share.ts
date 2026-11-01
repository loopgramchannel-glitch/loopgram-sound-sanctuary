import { toast } from "sonner";

export type SharePayload = { title?: string; text?: string; url: string };
export const SHARE_EVENT = "lg-share";

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export async function copyText(payload: string) {
  try {
    await navigator.clipboard.writeText(payload);
    toast.success("Link copied");
    return;
  } catch {}
  if (legacyCopy(payload)) toast.success("Link copied");
  else toast("Copy this link", { description: payload, duration: 10000 });
}

/** Direct share links for the big apps. Brand colors are the apps' own identities. */
export function shareTargets(p: SharePayload) {
  const u = encodeURIComponent(p.url);
  const msg = (p.text ?? p.title ?? "").trim();
  const m = encodeURIComponent(msg);
  const mu = encodeURIComponent(msg ? `${msg} ${p.url}` : p.url);
  return [
    { name: "WhatsApp", short: "WA", color: "#25D366", href: `https://wa.me/?text=${mu}` },
    { name: "Facebook", short: "f", color: "#1877F2", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { name: "X", short: "X", color: "#000000", href: `https://twitter.com/intent/tweet?text=${m}&url=${u}` },
    { name: "Telegram", short: "TG", color: "#229ED9", href: `https://t.me/share/url?url=${u}&text=${m}` },
    { name: "Messenger", short: "M", color: "#0084FF", href: `fb-messenger://share/?link=${u}` },
    { name: "Reddit", short: "R", color: "#FF4500", href: `https://www.reddit.com/submit?url=${u}&title=${m}` },
    { name: "LinkedIn", short: "in", color: "#0A66C2", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { name: "Pinterest", short: "P", color: "#E60023", href: `https://pinterest.com/pin/create/button/?url=${u}&description=${m}` },
    { name: "Threads", short: "@", color: "#000000", href: `https://www.threads.net/intent/post?text=${mu}` },
  ];
}

/** Opens the app's share window with every big app plus copy link. */
export async function shareLink(opts: SharePayload) {
  window.dispatchEvent(new CustomEvent<SharePayload>(SHARE_EVENT, { detail: opts }));
}
