import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuthStore } from "../lib/auth-store";
import {
  acceptFriendRequest,
  chatIdFor,
  declineFriendRequest,
  type FriendRequestDoc,
} from "../lib/chat";
import { BottomNav } from "../components/BottomNav";

export const Route = createFileRoute("/_app/friends")({
  head: () => ({ meta: [{ title: "Friend Requests — Daniyal Chat" }] }),
  component: FriendsPage,
});

type ReqRow = FriendRequestDoc & { id: string };

function FriendsPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [incoming, setIncoming] = useState<ReqRow[]>([]);
  const [outgoing, setOutgoing] = useState<ReqRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const u1 = onSnapshot(
      query(
        collection(db, "friendRequests"),
        where("to", "==", user.uid),
        where("status", "==", "pending"),
      ),
      (s) => setIncoming(s.docs.map((d) => ({ id: d.id, ...(d.data() as FriendRequestDoc) }))),
    );
    const u2 = onSnapshot(
      query(
        collection(db, "friendRequests"),
        where("from", "==", user.uid),
        where("status", "==", "pending"),
      ),
      (s) => setOutgoing(s.docs.map((d) => ({ id: d.id, ...(d.data() as FriendRequestDoc) }))),
    );
    return () => {
      u1();
      u2();
    };
  }, [user?.uid]);

  const onAccept = async (r: ReqRow) => {
    if (!user) return;
    setBusy(r.id);
    setError(null);
    try {
      await acceptFriendRequest(user.uid, r.from);
      navigate({ to: "/chat/$chatId", params: { chatId: chatIdFor(user.uid, r.from) } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to accept");
    } finally {
      setBusy(null);
    }
  };

  const onDecline = async (r: ReqRow) => {
    if (!user) return;
    setBusy(r.id);
    try {
      await declineFriendRequest(user.uid, r.from);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-[100dvh] mx-auto w-full max-w-2xl px-4 pt-6 pb-28 overflow-x-hidden">
      <header className="flex items-center gap-3 mb-6">
        <Link
          to="/chats"
          className="p-2 rounded-full glass hover:shadow-glow transition"
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
        </Link>
        <h1 className="text-2xl font-bold">Friend Requests</h1>
      </header>

      {error && <div className="mb-3 text-sm text-destructive text-center">{error}</div>}

      <section className="mb-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground px-2 mb-2">
          Incoming ({incoming.length})
        </div>
        {incoming.length === 0 ? (
          <div className="glass rounded-3xl p-6 text-center text-sm text-muted-foreground shadow-soft">
            No pending requests.
          </div>
        ) : (
          <div className="space-y-2">
            {incoming.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 p-3 rounded-2xl bg-surface shadow-soft animate-fade-up"
              >
                {r.fromProfile?.photoURL ? (
                  <img
                    src={r.fromProfile.photoURL}
                    alt=""
                    className="w-12 h-12 rounded-2xl object-cover"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-2xl gradient-brand grid place-items-center text-white font-bold">
                    {r.fromProfile?.displayName?.[0]?.toUpperCase() || "?"}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">
                    {r.fromProfile?.displayName || "User"}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    @{r.fromProfile?.username || "unknown"}
                  </div>
                </div>
                <button
                  onClick={() => onDecline(r)}
                  disabled={busy === r.id}
                  className="px-3 py-2 rounded-xl bg-muted text-sm font-semibold disabled:opacity-60"
                >
                  Decline
                </button>
                <button
                  onClick={() => onAccept(r)}
                  disabled={busy === r.id}
                  className="px-3 py-2 rounded-xl gradient-brand text-white text-sm font-semibold shadow-glow disabled:opacity-60"
                >
                  Accept
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="text-xs uppercase tracking-wide text-muted-foreground px-2 mb-2">
          Sent ({outgoing.length})
        </div>
        {outgoing.length === 0 ? (
          <div className="glass rounded-3xl p-6 text-center text-sm text-muted-foreground shadow-soft">
            You haven't sent any requests.
          </div>
        ) : (
          <div className="space-y-2">
            {outgoing.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 p-3 rounded-2xl bg-surface shadow-soft"
              >
                <div className="w-12 h-12 rounded-2xl bg-muted grid place-items-center text-muted-foreground">
                  …
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">Request pending</div>
                  <div className="text-xs text-muted-foreground truncate">Waiting for reply</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <BottomNav />
    </div>
  );
}
