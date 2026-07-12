import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuthStore } from "../lib/auth-store";
import { markRead, sendMessage, setTyping, type MessageDoc } from "../lib/chat";
import { format } from "date-fns";

export const Route = createFileRoute("/_app/chat/$chatId")({
  head: () => ({ meta: [{ title: "Chat — Daniyal Chat" }] }),
  component: ChatPage,
});

interface UserLite {
  uid: string; displayName: string; username: string; photoURL: string;
  presence?: { online?: boolean; lastSeen?: { toMillis?: () => number } };
}

function ChatPage() {
  const { chatId } = Route.useParams();
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<(MessageDoc & { id: string; createdAt?: { toMillis?: () => number } })[]>([]);
  const [other, setOther] = useState<UserLite | null>(null);
  const [text, setText] = useState("");
  const [theyTyping, setTheyTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // resolve other participant from chatId
  useEffect(() => {
    if (!user) return;
    const parts = chatId.split("_");
    const otherId = parts.find((p: string) => p !== user.uid);
    if (!otherId) return;
    getDoc(doc(db, "users", otherId)).then((s) => {
      if (s.exists()) setOther(s.data() as UserLite);
    });
    // presence listener
    return onSnapshot(doc(db, "users", otherId), (s) => {
      if (s.exists()) setOther(s.data() as UserLite);
    });
  }, [chatId, user?.uid]);

  // messages
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as MessageDoc & { createdAt?: { toMillis?: () => number } }) }));
      setMessages(items);
      // mark others' messages as read + delivered
      items.forEach((m) => {
        if (m.receiver === user.uid && m.status !== "read") {
          updateDoc(doc(db, "chats", chatId, "messages", m.id), { status: "read" }).catch(() => {});
        }
      });
      markRead(chatId, user.uid);
    });
    return () => unsub();
  }, [chatId, user?.uid]);

  // typing indicator (other user)
  useEffect(() => {
    if (!user) return;
    const otherId = chatId.split("_").find((p: string) => p !== user.uid);
    if (!otherId) return;
    return onSnapshot(doc(db, "chats", chatId, "typing", otherId), (s) => {
      const data = s.data() as { typing?: boolean; at?: { toMillis?: () => number } } | undefined;
      const fresh = data?.at?.toMillis?.() ? Date.now() - data.at.toMillis()! < 5000 : false;
      setTheyTyping(!!data?.typing && fresh);
    });
  }, [chatId, user?.uid]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, theyTyping]);

  const otherId = chatId.split("_").find((p: string) => p !== user?.uid) || "";

  const handleSend = async () => {
    const value = text.trim();
    if (!value || !user) return;
    setText("");
    setTyping(chatId, user.uid, false);
    await sendMessage(chatId, {
      type: "text",
      text: value,
      sender: user.uid,
      receiver: otherId,
    });
  };

  const onChangeText = (v: string) => {
    setText(v);
    if (!user) return;
    setTyping(chatId, user.uid, true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(chatId, user.uid, false), 2000);
  };

  const presenceLine = (() => {
    if (!other) return "";
    if (theyTyping) return "typing…";
    if (other.presence?.online) return "online";
    const ls = other.presence?.lastSeen?.toMillis?.();
    return ls ? `last seen ${format(new Date(ls), "p")}` : "offline";
  })();

  if (!user || !profile) return null;

  return (
    <div className="min-h-screen flex flex-col mx-auto max-w-2xl">
      {/* Header */}
      <header className="glass sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-border/60">
        <button onClick={() => navigate({ to: "/chats" })} className="p-2 rounded-full hover:bg-muted transition" aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        {other?.photoURL ? (
          <img src={other.photoURL} alt="" className="w-10 h-10 rounded-full object-cover" />
        ) : (
          <div className="w-10 h-10 rounded-full gradient-brand grid place-items-center text-white font-bold">
            {other?.displayName?.[0]?.toUpperCase() || "?"}
          </div>
        )}
        <div className="min-w-0">
          <div className="font-semibold truncate">{other?.displayName || "…"}</div>
          <div className={`text-xs ${theyTyping ? "text-primary" : "text-muted-foreground"}`}>{presenceLine}</div>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4 space-y-2">
        {messages.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-16">
            No messages yet. Say hi 👋
          </div>
        )}
        {messages.map((m, i) => {
          const mine = m.sender === user.uid;
          const prev = messages[i - 1];
          const showTail = !prev || prev.sender !== m.sender;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"} animate-fade-up`}>
              <div className={`max-w-[75%] px-4 py-2.5 rounded-3xl shadow-soft
                ${mine
                  ? "bg-bubble-me text-bubble-me-foreground rounded-br-md"
                  : "bg-bubble-them text-bubble-them-foreground rounded-bl-md border border-border/50"}
                ${!showTail ? "mt-0.5" : "mt-2"}`}>
                {m.type === "text" && <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.text}</div>}
                <div className={`text-[10px] mt-1 flex items-center gap-1 justify-end ${mine ? "text-white/70" : "text-muted-foreground"}`}>
                  {m.createdAt?.toMillis && <span>{format(new Date(m.createdAt.toMillis!()), "p")}</span>}
                  {mine && (
                    <span aria-label={m.status}>
                      {m.status === "read" ? "✓✓" : m.status === "delivered" ? "✓✓" : "✓"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {theyTyping && (
          <div className="flex justify-start">
            <div className="bg-bubble-them border border-border/50 px-4 py-3 rounded-3xl rounded-bl-md shadow-soft flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot" />
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot" style={{ animationDelay: "0.15s" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot" style={{ animationDelay: "0.3s" }} />
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="glass sticky bottom-0 p-3 border-t border-border/60">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => onChangeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder="Type a message…"
            rows={1}
            className="flex-1 resize-none max-h-32 bg-surface rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary/40 text-[15px]"
          />
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className="shrink-0 rounded-full gradient-brand text-white p-3 shadow-glow disabled:opacity-50 transition"
            aria-label="Send"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M2.4 20.4l19.2-8.4c.8-.4.8-1.6 0-2L2.4 1.6c-.7-.3-1.5.3-1.3 1.1L3.5 10 15 12 3.5 14l-2.4 7.3c-.2.8.6 1.4 1.3 1.1z"/></svg>
          </button>
        </div>
        <div className="text-[10px] text-muted-foreground text-center mt-2">Media (photos, video, voice, files) coming next</div>
      </div>
    </div>
  );
}
