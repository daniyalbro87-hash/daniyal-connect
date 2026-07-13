import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  getDocs,
  limit,
  doc,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuthStore } from "../lib/auth-store";
import { ensureChat, chatIdFor, sendFriendRequest } from "../lib/chat";
import { formatDistanceToNowStrict } from "date-fns";
import { BottomNav } from "../components/BottomNav";

export const Route = createFileRoute("/_app/chats")({
  head: () => ({ meta: [{ title: "Chats — Daniyal Chat" }] }),
  component: ChatsPage,
});

interface ChatItem {
  id: string;
  participants: string[];
  lastMessage: { preview: string; sender: string; type: string } | null;
  lastMessageAt: { toMillis?: () => number } | null;
  unread: Record<string, number>;
}
interface UserLite {
  uid: string;
  displayName: string;
  username: string;
  photoURL: string;
  presence?: { online?: boolean; lastSeen?: { toMillis?: () => number } };
}

function ChatsPage() {
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [others, setOthers] = useState<Record<string, UserLite>>({});
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<UserLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [reqState, setReqState] = useState<Record<string, "idle" | "sending" | "sent" | "error">>(
    {},
  );
  const [pendingOut, setPendingOut] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "chats"),
      where("participants", "array-contains", user.uid),
      orderBy("lastMessageAt", "desc"),
    );
    const unsub = onSnapshot(q, async (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChatItem, "id">) }));
      setChats(items);
      const otherIds = Array.from(
        new Set(items.flatMap((c) => c.participants.filter((p) => p !== user.uid))),
      ).filter((id) => !others[id]);
      if (otherIds.length) {
        const updates: Record<string, UserLite> = {};
        await Promise.all(
          otherIds.map(async (uid) => {
            const s = await getDocs(
              query(collection(db, "users"), where("uid", "==", uid), limit(1)),
            );
            s.forEach((d) => (updates[uid] = d.data() as UserLite));
          }),
        );
        if (Object.keys(updates).length) setOthers((prev) => ({ ...prev, ...updates }));
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Track my outgoing pending friend requests to show "Requested" state
  useEffect(() => {
    if (!user) return;
    const u = onSnapshot(
      query(
        collection(db, "friendRequests"),
        where("from", "==", user.uid),
        where("status", "==", "pending"),
      ),
      (s) => setPendingOut(new Set(s.docs.map((d) => (d.data() as { to: string }).to))),
    );
    return () => u();
  }, [user?.uid]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const term = search.trim().toLowerCase();
      if (!term) {
        setSearchResults([]);
        return;
      }
      setSearching(true);
      const snap = await getDocs(
        query(
          collection(db, "users"),
          where("username", ">=", term),
          where("username", "<=", term + "\uf8ff"),
          limit(10),
        ),
      );
      if (!active) return;
      setSearchResults(
        snap.docs.map((d) => d.data() as UserLite).filter((u) => u.uid !== user?.uid),
      );
      setSearching(false);
    };
    const t = setTimeout(run, 200);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [search, user?.uid]);

  const startChat = async (other: UserLite) => {
    if (!user) return;
    try {
      await ensureChat(user.uid, other.uid);
      navigate({ to: "/chat/$chatId", params: { chatId: chatIdFor(user.uid, other.uid) } });
    } catch (e) {
      console.error("Failed to open chat:", e);
    }
  };

  const sendRequest = async (other: UserLite) => {
    if (!user || !profile) return;
    setReqState((s) => ({ ...s, [other.uid]: "sending" }));
    try {
      await sendFriendRequest(user.uid, other.uid, {
        displayName: profile.displayName,
        username: profile.username,
        photoURL: profile.photoURL,
      });
      setReqState((s) => ({ ...s, [other.uid]: "sent" }));
    } catch (e) {
      console.error(e);
      setReqState((s) => ({ ...s, [other.uid]: "error" }));
    }
  };

  const sorted = useMemo(() => chats, [chats]);

  return (
    <div className="min-h-[100dvh] mx-auto w-full max-w-2xl px-4 pt-6 pb-32 overflow-x-hidden">
      {/* Header */}
      <header className="flex items-center justify-between mb-6 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <img src="/icon-512.png" alt="" className="w-10 h-10 rounded-2xl shadow-soft shrink-0" />
          <div className="min-w-0">
            <div className="text-lg font-bold leading-tight text-gradient-brand truncate">
              Daniyal Chat
            </div>
            <div className="text-xs text-muted-foreground truncate">
              Hi, {profile?.displayName?.split(" ")[0]}
            </div>
          </div>
        </div>
        <Link
          to="/profile"
          className="glass rounded-full p-1.5 hover:shadow-glow transition shrink-0"
          aria-label="Profile"
        >
          {profile?.photoURL ? (
            <img src={profile.photoURL} alt="" className="w-9 h-9 rounded-full object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-full gradient-brand grid place-items-center text-white text-sm font-bold">
              {profile?.displayName?.[0]?.toUpperCase() || "U"}
            </div>
          )}
        </Link>
      </header>

      {/* Search */}
      <div className="glass rounded-2xl p-3 mb-4 shadow-soft flex items-center gap-2">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-muted-foreground shrink-0"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users by username…"
          className="w-full bg-transparent outline-none px-1 py-1 text-sm"
        />
      </div>

      {searchResults.length > 0 && (
        <div className="mb-4 space-y-1 animate-fade-up">
          <div className="text-xs uppercase tracking-wide text-muted-foreground px-2 mb-1">
            People
          </div>
          {searchResults.map((u) => {
            const state = reqState[u.uid] || (pendingOut.has(u.uid) ? "sent" : "idle");
            return (
              <div
                key={u.uid}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3 rounded-2xl bg-surface hover:shadow-soft transition animate-fade-up"
              >
                <button onClick={() => startChat(u)} className="contents text-left">
                  <Avatar user={u} />
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{u.displayName}</div>
                    <div className="text-xs text-muted-foreground truncate">@{u.username}</div>
                  </div>
                </button>
                <button
                  onClick={() => sendRequest(u)}
                  disabled={state === "sending" || state === "sent"}
                  className={`shrink-0 px-3 py-2 rounded-xl text-xs font-semibold transition ${
                    state === "sent"
                      ? "bg-muted text-muted-foreground"
                      : "gradient-brand text-white shadow-glow"
                  } disabled:opacity-70`}
                >
                  {state === "sent" ? "Requested" : state === "sending" ? "…" : "Add"}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {searching && (
        <div className="text-xs text-muted-foreground text-center py-2">Searching…</div>
      )}

      {/* Chats */}
      <div className="space-y-2">
        {sorted.length === 0 && !search && (
          <div className="glass rounded-3xl p-10 text-center shadow-soft">
            <div className="text-4xl mb-2">💬</div>
            <div className="font-semibold">No conversations yet</div>
            <div className="text-sm text-muted-foreground mt-1">
              Search a username or tap + to invite someone.
            </div>
          </div>
        )}
        {sorted.map((c) => {
          const otherId = c.participants.find((p) => p !== user?.uid)!;
          const other = others[otherId];
          const unread = c.unread?.[user!.uid] || 0;
          const t = c.lastMessageAt?.toMillis?.();
          return (
            <Link
              key={c.id}
              to="/chat/$chatId"
              params={{ chatId: c.id }}
              className="flex items-center gap-3 p-3 rounded-2xl bg-surface hover:shadow-soft transition animate-fade-up"
            >
              <Avatar user={other} />
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline gap-2">
                  <div className="font-semibold truncate">{other?.displayName || "Loading…"}</div>
                  {t && (
                    <div className="text-[11px] text-muted-foreground shrink-0">
                      {formatDistanceToNowStrict(new Date(t))}
                    </div>
                  )}
                </div>
                <div className="flex justify-between items-center gap-2">
                  <div className="text-sm text-muted-foreground truncate">
                    {c.lastMessage?.preview || "Say hi 👋"}
                  </div>
                  {unread > 0 && (
                    <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full gradient-brand text-white text-[11px] font-bold grid place-items-center shadow-glow">
                      {unread}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <BottomNav />
    </div>
  );
}

function Avatar({ user }: { user?: UserLite }) {
  const online = user?.presence?.online;
  return (
    <div className="relative shrink-0">
      {user?.photoURL ? (
        <img src={user.photoURL} alt="" className="w-12 h-12 rounded-2xl object-cover" />
      ) : (
        <div className="w-12 h-12 rounded-2xl gradient-brand grid place-items-center text-white font-bold">
          {user?.displayName?.[0]?.toUpperCase() || "?"}
        </div>
      )}
      {online && (
        <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-white" />
      )}
    </div>
  );
}
