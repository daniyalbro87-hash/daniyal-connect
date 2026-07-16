import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuthStore } from "../lib/auth-store";
import { markRead, type MessageDoc } from "../lib/chat";
import { useSettingsStore, PRESET_WALLPAPERS } from "../lib/settings-store";
import { format } from "date-fns";
import { MessageMedia } from "../components/MessageMedia";
import { ImageViewer } from "../components/ImageViewer";
import { Composer } from "../components/Composer";
import { Phone } from "lucide-react";
import { startOutgoingCall, unlockAudioPlayback } from "../lib/webrtc";
import { useCallStore } from "../lib/call-store";

export const Route = createFileRoute("/_app/chat/$chatId")({
  head: () => ({ meta: [{ title: "Chat — Daniyal Chat" }] }),
  component: ChatPage,
});

interface UserLite {
  uid: string;
  displayName: string;
  username: string;
  photoURL: string;
  presence?: { online?: boolean; lastSeen?: { toMillis?: () => number } };
}

type MsgWithTs = MessageDoc & { id: string; createdAt?: { toMillis?: () => number } };

function ChatPage() {
  const { chatId } = Route.useParams();
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<MsgWithTs[]>([]);
  const [other, setOther] = useState<UserLite | null>(null);
  const [theyTyping, setTheyTyping] = useState(false);
  const [viewer, setViewer] = useState<{ urls: string[]; index: number } | null>(null);
  const [callPending, setCallPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const callLockRef = useRef(false);
  const callUi = useCallStore((s) => s.ui);

  const otherId = chatId.split("_").find((p: string) => p !== user?.uid) || "";

  useEffect(() => {
    if (!user || !otherId) return;
    return onSnapshot(doc(db, "users", otherId), (s) => {
      if (s.exists()) setOther(s.data() as UserLite);
    });
  }, [otherId, user?.uid]);

  const readReceipts = useSettingsStore((s) => s.settings.readReceipts);
  const wallpaperKey = useSettingsStore((s) => s.settings.wallpaper);
  const wallpaperCss = PRESET_WALLPAPERS[wallpaperKey]?.css;

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as MessageDoc & { createdAt?: { toMillis?: () => number } }),
      }));
      setMessages(items);
      items.forEach((m) => {
        if (m.receiver === user.uid) {
          const target = readReceipts ? "read" : "delivered";
          if (m.status !== target && !(m.status === "read" && target === "delivered")) {
            updateDoc(doc(db, "chats", chatId, "messages", m.id), { status: target }).catch(
              () => {},
            );
          }
        }
      });
      markRead(chatId, user.uid);
    });
    return () => unsub();
  }, [chatId, user?.uid, readReceipts]);

  useEffect(() => {
    if (!user || !otherId) return;
    return onSnapshot(doc(db, "chats", chatId, "typing", otherId), (s) => {
      const data = s.data() as { typing?: boolean; at?: { toMillis?: () => number } } | undefined;
      const fresh = data?.at?.toMillis?.() ? Date.now() - data.at.toMillis()! < 5000 : false;
      setTheyTyping(!!data?.typing && fresh);
    });
  }, [chatId, otherId, user?.uid]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, theyTyping]);

  if (!user || !profile) return null;

  const presenceLine = (() => {
    if (!other) return "";
    if (theyTyping) return "typing…";
    if (other.presence?.online) return "online";
    const ls = other.presence?.lastSeen?.toMillis?.();
    return ls ? `last seen ${format(new Date(ls), "p")}` : "offline";
  })();

  return (
    <div
      className="h-[100dvh] flex flex-col mx-auto w-full max-w-2xl overflow-hidden"
      style={wallpaperCss ? { background: wallpaperCss } : undefined}
    >
      <header className="glass sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-border/60">
        <button
          onClick={() => navigate({ to: "/chats" })}
          className="p-2 rounded-full hover:bg-muted transition"
          aria-label="Back"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        {other?.photoURL ? (
          <img src={other.photoURL} alt="" className="w-10 h-10 rounded-full object-cover" />
        ) : (
          <div className="w-10 h-10 rounded-full gradient-brand grid place-items-center text-white font-bold">
            {other?.displayName?.[0]?.toUpperCase() || "?"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{other?.displayName || "…"}</div>
          <div className={`text-xs ${theyTyping ? "text-primary" : "text-muted-foreground"}`}>
            {presenceLine}
          </div>
        </div>
        <button
          onClick={async () => {
            if (!other || !profile || callPending || callLockRef.current || callUi !== "idle") return;
            callLockRef.current = true;
            setCallPending(true);
            unlockAudioPlayback().catch(() => {});
            useCallStore.getState().set({
              ui: "outgoing",
              session: null,
              peer: {
                uid: other.uid,
                displayName: other.displayName,
                photoURL: other.photoURL,
                username: other.username,
              },
              status: "ringing",
              startedAt: null,
            });
            try {
              const session = await startOutgoingCall({
                caller: user.uid,
                callee: other.uid,
                callerProfile: {
                  displayName: profile.displayName,
                  photoURL: profile.photoURL,
                  username: profile.username,
                },
              });
              useCallStore.getState().set({
                ui: "outgoing",
                session,
                peer: {
                  uid: other.uid,
                  displayName: other.displayName,
                  photoURL: other.photoURL,
                  username: other.username,
                },
                status: "ringing",
                startedAt: null,
              });
            } catch (e) {
              console.error("Call failed", e);
              useCallStore.getState().reset();
              alert(e instanceof Error ? e.message : "Could not start call");
            } finally {
              setCallPending(false);
              setTimeout(() => { callLockRef.current = false; }, 500);
            }
          }}
          disabled={callPending || callUi !== "idle"}
          className="p-2 rounded-full hover:bg-muted transition shrink-0 disabled:opacity-50 disabled:pointer-events-none"
          aria-label="Voice call"
        >
          <Phone size={20} />
        </button>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin px-3 py-4 space-y-1 overscroll-contain [scroll-behavior:smooth]"
      >
        {messages.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-16">
            No messages yet. Say hi 👋
          </div>
        )}
        {messages.map((m, i) => {
          const mine = m.sender === user.uid;
          const prev = messages[i - 1];
          const showTail = !prev || prev.sender !== m.sender;
          const hasText = m.type === "text";
          return (
            <div
              key={m.id}
              className={`flex ${mine ? "justify-end" : "justify-start"} animate-fade-up`}
            >
              <div
                className={`max-w-[80%] ${showTail ? "mt-2" : "mt-0.5"} ${hasText ? "px-4 py-2.5" : "p-1.5"} rounded-3xl shadow-soft
                ${
                  mine
                    ? "bg-bubble-me text-bubble-me-foreground rounded-br-md"
                    : "bg-bubble-them text-bubble-them-foreground rounded-bl-md border border-border/50"
                }`}
              >
                {hasText && (
                  <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                    {m.text}
                  </div>
                )}
                {!hasText && (
                  <div className={mine ? "" : ""}>
                    <MessageMedia
                      msg={m}
                      onOpenImage={(urls, index) => setViewer({ urls, index })}
                    />
                    {m.text && <div className="px-2 pt-2 pb-1 text-[14px]">{m.text}</div>}
                  </div>
                )}
                <div
                  className={`text-[10px] mt-1 flex items-center gap-1 justify-end ${mine ? "text-white/70" : "text-muted-foreground"} ${hasText ? "" : "px-2 pb-1"}`}
                >
                  {m.createdAt?.toMillis && (
                    <span>{format(new Date(m.createdAt.toMillis!()), "p")}</span>
                  )}
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
              <span
                className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot"
                style={{ animationDelay: "0.15s" }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot"
                style={{ animationDelay: "0.3s" }}
              />
            </div>
          </div>
        )}
      </div>

      <Composer chatId={chatId} senderId={user.uid} receiverId={otherId} />

      {viewer && (
        <ImageViewer urls={viewer.urls} index={viewer.index} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}
