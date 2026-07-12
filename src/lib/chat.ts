import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";

export function chatIdFor(a: string, b: string): string {
  return [a, b].sort().join("_");
}

export interface MessageDoc {
  id?: string;
  type: "text" | "image" | "video" | "audio" | "file" | "images";
  text?: string;
  media?: Array<{
    secure_url: string;
    public_id: string;
    mime: string;
    size: number;
    width?: number;
    height?: number;
    duration?: number;
    filename?: string;
  }>;
  sender: string;
  receiver: string;
  createdAt?: unknown;
  status?: "sent" | "delivered" | "read";
}

export async function ensureChat(a: string, b: string) {
  const id = chatIdFor(a, b);
  const ref = doc(db, "chats", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      participants: [a, b].sort(),
      createdAt: serverTimestamp(),
      lastMessage: null,
      lastMessageAt: serverTimestamp(),
      unread: { [a]: 0, [b]: 0 },
    });
  }
  return id;
}

export async function sendMessage(chatId: string, msg: MessageDoc) {
  const ref = collection(db, "chats", chatId, "messages");
  const created = await addDoc(ref, {
    ...msg,
    createdAt: serverTimestamp(),
    status: "sent",
  });
  const preview =
    msg.type === "text"
      ? msg.text?.slice(0, 120) || ""
      : msg.type === "image" || msg.type === "images"
        ? "📷 Photo"
        : msg.type === "video"
          ? "🎥 Video"
          : msg.type === "audio"
            ? "🎤 Voice note"
            : "📎 Document";
  await updateDoc(doc(db, "chats", chatId), {
    lastMessage: { preview, sender: msg.sender, type: msg.type },
    lastMessageAt: serverTimestamp(),
    [`unread.${msg.receiver}`]: (await getDoc(doc(db, "chats", chatId))).data()?.unread?.[msg.receiver] + 1 || 1,
  });
  return created.id;
}

export async function markRead(chatId: string, uid: string) {
  await updateDoc(doc(db, "chats", chatId), { [`unread.${uid}`]: 0 }).catch(() => {});
}

export async function setTyping(chatId: string, uid: string, typing: boolean) {
  await setDoc(doc(db, "chats", chatId, "typing", uid), {
    typing,
    at: serverTimestamp(),
  }).catch(() => {});
}
