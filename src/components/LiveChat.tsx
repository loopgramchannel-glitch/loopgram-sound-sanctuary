import { useEffect, useState } from "react";
import { Send } from "lucide-react";

type Chat = { n: string; m: string; t: number };
const REACTIONS = ["🔥", "😂", "🍿", "❤️", "👏"];

export function useMe() {
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    let id = localStorage.getItem("lg:me");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("lg:me", id); }
    setMe({ id, name: localStorage.getItem("lg:name") ?? "" });
  }, []);
  const setName = (name: string) => { localStorage.setItem("lg:name", name); setMe((m) => (m ? { ...m, name } : m)); };
  return { me, setName };
}

export function LiveChat({ chat, onSend }: { chat: Chat[]; onSend: (name: string, msg: string) => Promise<unknown> }) {
  const { me, setName } = useMe();
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const send = async (m: string) => {
    if (!me?.name || !m.trim()) return;
    setErr("");
    try { await onSend(me.name, m.trim()); setMsg(""); } catch (e: any) { setErr(e?.message ?? "Couldn't send"); }
  };
  return (
    <div className="flex flex-col rounded-xl border">
      <ul className="flex max-h-72 min-h-32 flex-col gap-1 overflow-y-auto p-3 text-sm" aria-live="polite">
        {chat.length === 0 && <li className="text-muted-foreground">No messages yet. Say hi!</li>}
        {chat.map((c, i) => <li key={c.t + ":" + i}><b>{c.n}</b> <span className="break-words">{c.m}</span></li>)}
      </ul>
      {me && !me.name ? (
        <form className="flex gap-2 border-t p-2" onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get("n")?.toString().trim().slice(0, 24); if (v) setName(v); }}>
          <input name="n" placeholder="Your name to chat" maxLength={24} className="min-w-0 flex-1 rounded-full border bg-background px-3 py-1.5 text-sm" />
          <button className="rounded-full bg-primary px-4 text-sm text-primary-foreground">Join chat</button>
        </form>
      ) : (
        <>
          <div className="flex gap-1 border-t px-2 pt-2">{REACTIONS.map((r) => <button key={r} onClick={() => send(r)} className="rounded-full px-2 py-1 text-lg hover:bg-accent" aria-label={`Send ${r}`}>{r}</button>)}</div>
          <form className="flex gap-2 p-2" onSubmit={(e) => { e.preventDefault(); send(msg); }}>
            <input value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={200} placeholder="Write a message" className="min-w-0 flex-1 rounded-full border bg-background px-3 py-1.5 text-sm" />
            <button className="rounded-full bg-primary p-2 text-primary-foreground" aria-label="Send"><Send className="h-4 w-4" /></button>
          </form>
        </>
      )}
      {err && <p className="px-3 pb-2 text-xs text-destructive">{err}</p>}
    </div>
  );
}
