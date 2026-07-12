import { useEffect, useRef } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuthStore } from "../lib/auth-store";

// Fires browser notifications for new messages when the tab is hidden.
export function NotificationsBridge() {
  const user = useAuthStore((s) => s.user);
  const initialSnapshotDone = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user || typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      // Request lazily after a small delay so it doesn't fire on first load.
      const t = setTimeout(() => Notification.requestPermission().catch(() => {}), 4000);
      return () => clearTimeout(t);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "chats"), where("participants", "array-contains", user.uid));
    const unsub = onSnapshot(q, (snap) => {
      snap.docChanges().forEach((ch) => {
        const chat = ch.doc.data() as { lastMessage?: { preview: string; sender: string }; participants: string[] };
        const chatId = ch.doc.id;
        const isFirst = !initialSnapshotDone.current.has(chatId);
        initialSnapshotDone.current.add(chatId);
        if (isFirst) return;
        if (ch.type !== "modified") return;
        const last = chat.lastMessage;
        if (!last || last.sender === user.uid) return;
        if (document.visibilityState === "visible" && location.pathname.includes(chatId)) return;
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          try {
            const n = new Notification("Daniyal Chat", { body: last.preview, icon: "/icon-512.png", tag: chatId });
            n.onclick = () => { window.focus(); window.location.href = `/chat/${chatId}`; };
          } catch { /* ignore */ }
        }
      });
    });
    return () => unsub();
  }, [user?.uid]);

  return null;
}
