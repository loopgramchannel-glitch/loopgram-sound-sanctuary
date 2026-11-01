import { Link, useNavigate } from "@tanstack/react-router";
import { InstallButton } from "./InstallButton";
import { Bookmark, LayoutDashboard, LogIn, LogOut, Compass, Gamepad2, Home, Mail, PlaySquare, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { setState, getState } from "@/lib/store";
import { dueAlerts } from "@/lib/taste";
import { autoLowData, isSlowNetwork } from "@/lib/speed";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { prefetchDiscover } from "@/components/Browse";
import { useAuth } from "@/hooks/useAuth";

const NAV = [
  { to: "/", label: "Home", icon: Home },
  { to: "/explore", label: "Explore", icon: Compass },
  { to: "/posts", label: "Videos", icon: PlaySquare },
  { to: "/watchlist", label: "You", icon: Bookmark },
  { to: "/game", label: "Game", icon: Gamepad2 },
] as const;

function useAlerts() {
  useEffect(() => {
    const s = getState();
    const today = new Date().toISOString().slice(0, 10);
    const due = dueAlerts(s.watchlist, s.seenAlerts, today);
    if (!due.length) return;
    setState((st) => ({
      ...st,
      seenAlerts: [...st.seenAlerts, ...due.map((d) => `${d.key}@${d.date}`)].slice(-1000),
      alerts: [...due.map((d) => ({ key: d.key, text: `${d.title} releases ${d.date === today ? "today" : d.date}`, at: Date.now() })), ...st.alerts].slice(0, 50),
    }));
    if ("Notification" in window && Notification.permission === "granted")
      for (const d of due.slice(0, 3)) new Notification("LoopgramChannel release alert", { body: `${d.title} — ${d.date}` });
  }, []);
}

export function Shell({ children }: { children: React.ReactNode }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const auth = useAuth();
  const [offline, setOffline] = useState(false);
  useAlerts();
  useEffect(() => {
    const on = () => setOffline(!navigator.onLine);
    autoLowData();
    // Background warm-up of Game + Explore data (same query keys as those pages) so they open instantly.
    const warm = setTimeout(() => {
      if (isSlowNetwork()) return;
      void qc.prefetchQuery({ queryKey: ["game"], queryFn: () => api({ a: "game" }), staleTime: 30 * 60_000 });
      void qc.prefetchQuery({ queryKey: ["genres"], queryFn: () => api({ a: "genres" }), staleTime: Infinity });
      prefetchDiscover(qc, "movie", "popularity.desc");
    }, 1500);
    on(); addEventListener("online", on); addEventListener("offline", on);
    if ("serviceWorker" in navigator) {
      const h = location.hostname;
      const blocked = !import.meta.env.PROD || window.self !== window.top || /^(id-)?preview--/.test(h) || /(^|\.)lovableproject(-dev)?\.com$/.test(h) || /(^|\.)beta\.lovable\.dev$/.test(h) || new URLSearchParams(location.search).get("sw") === "off";
      if (blocked) navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.active?.scriptURL.endsWith("/sw.js") && r.unregister())).catch(() => {});
      else navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    return () => { clearTimeout(warm); removeEventListener("online", on); removeEventListener("offline", on); };
  }, []);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:gap-3 sm:px-4">
        <Link to="/" className="flex min-w-0 items-center gap-1.5 text-base font-black tracking-tight sm:text-lg" aria-label="LoopgramChannel home">
          <img src="/icon.svg" alt="" className="h-7 w-7 shrink-0" /><span className="truncate">LoopgramChannel</span>
        </Link>
        <form className="mx-auto hidden max-w-xl flex-1 md:flex" onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav({ to: "/search", search: { q: q.trim() } }); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search movies, TV, people" aria-label="Search"
            className="h-10 flex-1 rounded-l-full border bg-background px-4 text-sm outline-none focus:border-ring" />
          <button className="h-10 rounded-r-full border border-l-0 bg-secondary px-5" aria-label="Submit search"><Search className="h-4 w-4" /></button>
        </form>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1 md:ml-0">
          <InstallButton />
          <Link to="/search" search={{ q: "" }} className="rounded-full p-2 hover:bg-accent md:hidden" aria-label="Search"><Search className="h-5 w-5" /></Link>
          {auth.ready && !auth.user && (
            <Link to="/login" aria-label="Sign in" className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border p-2 text-sm hover:bg-accent sm:px-3 sm:py-1.5"><LogIn className="h-4 w-4" /><span className="hidden sm:inline">Sign in</span></Link>
          )}
          {auth.user && auth.role === "owner" && (
            <Link to="/studio" className="rounded-full p-2 hover:bg-accent" aria-label="Open Studio" title="Studio"><LayoutDashboard className="h-5 w-5" /></Link>
          )}
          {auth.user && (
            <button onClick={async () => { await qc.cancelQueries(); await auth.signOut(); nav({ to: "/", replace: true }); }} className="rounded-full p-2 hover:bg-accent" aria-label={`Sign out ${auth.user.email ?? ""}`} title="Sign out"><LogOut className="h-5 w-5" /></button>
          )}
        </div>
      </header>
      <div className="flex">
        <nav className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-20 shrink-0 flex-col items-center gap-1 pt-2 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className="flex w-16 flex-col items-center gap-1 rounded-lg py-3 text-[10px] hover:bg-accent" activeProps={{ className: "bg-accent font-bold" }} activeOptions={{ exact: n.to === "/" }}>
              <n.icon className="h-5 w-5" />{n.label}
            </Link>
          ))}
          <Link to="/az" className="flex w-16 flex-col items-center gap-1 rounded-lg py-3 text-[10px] hover:bg-accent" activeProps={{ className: "bg-accent font-bold" }}>A–Z</Link>
          <Link to="/compare" className="flex w-16 flex-col items-center gap-1 rounded-lg py-3 text-[10px] hover:bg-accent" activeProps={{ className: "bg-accent font-bold" }}>Compare</Link>
        </nav>
        <main className="min-w-0 flex-1">
          {offline && <p className="bg-secondary px-4 py-2 text-center text-xs">You're offline. Showing saved content where available.</p>}
          {children}
        </main>
      </div>
      <footer className="mt-8 border-t" aria-label="Contact LoopgramChannel">
        <div className="flex items-center justify-center gap-2 px-4 py-3">
          <a href="mailto:loopgramchannel@gmail.com" aria-label="Email LoopgramChannel"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-accent">
            <Mail className="h-5 w-5" aria-hidden />
          </a>
        </div>
        <div aria-hidden className="md:hidden" style={{ height: "calc(4rem + env(safe-area-inset-bottom))" }} />
      </footer>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background/95 backdrop-blur md:hidden" aria-label="Main mobile" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] text-muted-foreground" activeProps={{ className: "!text-foreground font-bold" }} activeOptions={{ exact: n.to === "/" }}>
            <n.icon className="h-5 w-5" />{n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
