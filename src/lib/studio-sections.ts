import { Archive, Radio, BarChart3, Newspaper, FileText, Film, Flag, Home, Image, LayoutGrid, Layers, ListChecks, Megaphone, Plug, Search, Shield, Users } from "lucide-react";

// Lives outside the route file: it's used by both validateSearch and the component,
// and TanStack's code splitter can't share a non-exported route-file constant.
export const SECTIONS = [
  { id: "overview", label: "Overview", icon: LayoutGrid, ready: true },
  { id: "users", label: "User Management", icon: Users, ready: true },
  { id: "posts", label: "Posts", icon: Newspaper, ready: true },
  { id: "live", label: "Live & Community", icon: Radio, ready: true },
  { id: "media", label: "Media Library", icon: Image, ready: true },
  { id: "search", label: "Search Management", icon: Search, ready: true },
  { id: "announcements", label: "Announcements & Settings", icon: Megaphone, ready: true },
  { id: "jobs", label: "Background Jobs", icon: ListChecks, ready: true },
  { id: "health", label: "Integrations & Health", icon: Plug, ready: true },
  { id: "audit", label: "Security & Audit Log", icon: Shield, ready: true },
  { id: "content", label: "Content Library", icon: FileText, ready: true },
  { id: "vault", label: "Saved Library", icon: Archive, ready: true },
  { id: "titles", label: "Movies and TV", icon: Film, ready: true },
  { id: "collections", label: "Categories & Collections", icon: Layers, ready: true },
  { id: "homepage", label: "Homepage Manager", icon: Home, ready: true },
  { id: "moderation", label: "Moderation", icon: Flag, ready: true },
  { id: "analytics", label: "Analytics", icon: BarChart3, ready: true },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];
