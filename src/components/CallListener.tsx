import { useEffect } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuthStore } from "../lib/auth-store";
import { useCallStore } from "../lib/call-store";
import type { CallDoc } from "../lib/webrtc";

/** Watches for incoming ringing calls to me and pops the CallOverlay. */
export function CallListener() {
  const user = useAuthStore((s) => s.user);
  const setFromIncoming = useCallStore((s) => s.setFromIncoming);
  const ui = useCallStore((s) => s.ui);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "calls"),
      where("callee", "==", user.uid),
      where("status", "==", "ringing"),
    );
    const unsub = onSnapshot(q, (snap) => {
      if (ui !== "idle") return;
      const first = snap.docs[0];
      if (!first) return;
      const data = first.data() as CallDoc;
      // Ignore stale rings older than 45s
      const created = (data.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.();
      if (created && Date.now() - created > 45_000) return;
      setFromIncoming(first.id, data);
      // Foreground browser notification for the incoming call
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("Incoming call", {
            body: `${data.callerProfile?.displayName || "Someone"} is calling…`,
            icon: "/icon-512.png",
            tag: `call-${first.id}`,
          });
        } catch { /* ignore */ }
      }
    });
    return () => unsub();
  }, [user?.uid, ui, setFromIncoming]);

  return null;
}
