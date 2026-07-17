import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuthStore } from "../lib/auth-store";
import { chatIdFor, ensureChat, requestId, sendFriendRequest } from "../lib/chat";
import { format, formatDistanceToNowStrict } from "date-fns";
import { MessageCircle, UserPlus, Check, Clock, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_app/user/$uid")({
  head: () => ({ meta: [{ title: "Profile — Daniyal Chat" }] }),
  component: UserProfilePage,
});

interface UserLite {
  uid: string;
  displayName: string;
  username: string;
  photoURL: string;
  bio?: string;
  presence?: { online?: boolean; lastSeen?: { toMillis?: () => number } };
}

type Friendship = "self" | "friends" | "pending_out" | "pending_in" | "none" | "loading";

function UserProfilePage() {
  const { uid } = Route.useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuthStore();
  const [target, setTarget] = useState<UserLite | null>(null);
  const [friendship, setFriendship] = useState<Friendship>("loading");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(db, "users", uid), (s) => {
      if (s.exists()) setTarget({ uid, ...(s.data() as Omit<UserLite, "uid">) });
    });
    return () => unsub();
  }, [uid]);

  useEffect(() => {
    if (!user || !uid) return;
    if (user.uid === uid) { setFriendship("self"); return; }
    let cancelled = false;
    (async () => {
      // Check both directions of friendRequests
      const [outSnap, inSnap] = await Promise.all([
        getDoc(doc(db, "friendRequests", requestId(user.uid, uid))),
        getDoc(doc(db, "friendRequests", requestId(uid, user.uid))),
      ]).catch(() => [null, null] as const);
      if (cancelled) return;
      const out = outSnap?.exists() ? (outSnap.data() as { status?: string }) : null;
      const inc = inSnap?.exists() ? (inSnap.data() as { status?: string }) : null;
      if (out?.status === "accepted" || inc?.status === "accepted") {
        setFriendship("friends"); return;
      }
      if (out?.status === "pending") { setFriendship("pending_out"); return; }
      if (inc?.status === "pending") { setFriendship("pending_in"); return; }
      // Fall back: if chat exists between the two, treat as friends.
      const chatSnap = await getDocs(query(
        collection(db, "chats"),
        where("participants", "array-contains", user.uid),
      ));
      const has = chatSnap.docs.some((d) => {
        const p = (d.data() as { participants?: string[] }).participants || [];
        return p.includes(uid);
      });
      setFriendship(has ? "friends" : "none");
    })();
    return () => { cancelled = true; };
  }, [user?.uid, uid]);

  if (!user || !profile) return null;

  const openChat = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await ensureChat(user.uid, target.uid);
      navigate({ to: "/chat/$chatId", params: { chatId: chatIdFor(user.uid, target.uid) } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open chat");
    } finally {
      setBusy(false);
    }
  };

  const addFriend = async () => {
    if (!target) return;
    setBusy(true);
    setErr(null);
    try {
      await sendFriendRequest(user.uid, target.uid, {
        displayName: profile.displayName,
        username: profile.username,
        photoURL: profile.photoURL,
      });
      setFriendship("pending_out");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send request");
    } finally {
      setBusy(false);
    }
  };

  const online = target?.presence?.online;
  const lastSeenMs = target?.presence?.lastSeen?.toMillis?.();
  const presenceLine = online
    ? "Online now"
    : lastSeenMs
      ? `Last seen ${formatDistanceToNowStrict(new Date(lastSeenMs))} ago · ${format(new Date(lastSeenMs), "p")}`
      : "Offline";

  return (
    <div className="min-h-[100dvh] mx-auto w-full max-w-2xl px-4 pt-6 pb-32">
      <button
        onClick={() => navigate({ to: "/chats" })}
        className="glass rounded-full p-2 mb-4 inline-flex items-center gap-2 text-sm hover:shadow-soft transition"
        aria-label="Back"
      >
        <ArrowLeft size={18} />
        <span className="pr-2">Back</span>
      </button>

      {!target ? (
        <div className="glass rounded-3xl p-10 text-center animate-pulse">Loading profile…</div>
      ) : (
        <div className="glass rounded-3xl p-6 shadow-soft flex flex-col items-center text-center animate-fade-up">
          <div className="relative mb-4">
            {target.photoURL ? (
              <img src={target.photoURL} alt="" className="w-28 h-28 rounded-full object-cover ring-4 ring-white/10 shadow-glow" />
            ) : (
              <div className="w-28 h-28 rounded-full gradient-brand grid place-items-center text-4xl font-bold text-white shadow-glow">
                {target.displayName?.[0]?.toUpperCase() || "?"}
              </div>
            )}
            {online && (
              <span className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-emerald-500 ring-4 ring-background" />
            )}
          </div>
          <h1 className="text-2xl font-bold">{target.displayName}</h1>
          <div className="text-sm text-muted-foreground">@{target.username}</div>
          <div className={`text-xs mt-1 ${online ? "text-emerald-500" : "text-muted-foreground"}`}>
            {presenceLine}
          </div>
          {target.bio && (
            <p className="mt-4 text-sm text-foreground/80 max-w-md whitespace-pre-wrap">{target.bio}</p>
          )}

          {err && <div className="mt-3 text-sm text-red-500">{err}</div>}

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 w-full">
            {friendship === "self" && (
              <button
                onClick={() => navigate({ to: "/profile" })}
                className="px-5 py-2.5 rounded-full gradient-brand text-white text-sm font-semibold shadow-glow active:scale-95 transition"
              >
                Edit your profile
              </button>
            )}
            {friendship !== "self" && (
              <button
                onClick={openChat}
                disabled={busy}
                className="px-5 py-2.5 rounded-full gradient-brand text-white text-sm font-semibold shadow-glow active:scale-95 transition inline-flex items-center gap-2 disabled:opacity-60"
              >
                <MessageCircle size={16} /> Message
              </button>
            )}
            {friendship === "none" && (
              <button
                onClick={addFriend}
                disabled={busy}
                className="px-5 py-2.5 rounded-full bg-surface border border-border text-sm font-semibold active:scale-95 transition inline-flex items-center gap-2 disabled:opacity-60"
              >
                <UserPlus size={16} /> Add friend
              </button>
            )}
            {friendship === "pending_out" && (
              <span className="px-5 py-2.5 rounded-full bg-muted text-muted-foreground text-sm font-semibold inline-flex items-center gap-2">
                <Clock size={16} /> Request sent
              </span>
            )}
            {friendship === "pending_in" && (
              <button
                onClick={() => navigate({ to: "/friends" })}
                className="px-5 py-2.5 rounded-full bg-surface border border-border text-sm font-semibold active:scale-95 transition inline-flex items-center gap-2"
              >
                Respond to request
              </button>
            )}
            {friendship === "friends" && (
              <span className="px-5 py-2.5 rounded-full bg-emerald-500/10 text-emerald-500 text-sm font-semibold inline-flex items-center gap-2">
                <Check size={16} /> Friends
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
