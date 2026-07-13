import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(len = 7) {
  let out = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[arr[i] % CODE_ALPHABET.length];
  return out;
}

/** Create a unique invite code that points to the owner's uid. */
export async function createInviteCode(uid: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(7);
    const ref = doc(db, "inviteCodes", code);
    const snap = await getDoc(ref);
    if (snap.exists()) continue;
    await setDoc(ref, { uid, createdAt: serverTimestamp() });
    return code;
  }
  throw new Error("Could not generate invite code, please try again.");
}

/** Resolve invite code -> owner uid. Throws user-friendly errors. */
export async function resolveInviteCode(rawCode: string, selfUid: string): Promise<string> {
  const code = rawCode.trim().toUpperCase();
  if (!code) throw new Error("Please enter an invite code.");
  const snap = await getDoc(doc(db, "inviteCodes", code));
  if (!snap.exists()) throw new Error("Invalid invite code.");
  const ownerUid = (snap.data() as { uid?: string }).uid;
  if (!ownerUid) throw new Error("Invalid invite code.");
  if (ownerUid === selfUid) throw new Error("That's your own code — share it with a friend.");
  return ownerUid;
}

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

/**
 * Ensure a 1:1 chat exists between a and b. Uses setDoc without a prior read so
 * it works under Firestore rules that gate reads on membership (which fail for
 * non-existent docs). Safe to call repeatedly — merge preserves existing data.
 */
export async function ensureChat(a: string, b: string) {
  const id = chatIdFor(a, b);
  const ref = doc(db, "chats", id);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) return id;
  } catch {
    // Read may fail (permission-denied on non-existent doc). Fall through to create.
  }
  await setDoc(
    ref,
    {
      participants: [a, b].sort(),
      createdAt: serverTimestamp(),
      lastMessage: null,
      lastMessageAt: serverTimestamp(),
      unread: { [a]: 0, [b]: 0 },
    },
    { merge: true },
  );
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
  const chatRef = doc(db, "chats", chatId);
  const cur = await getDoc(chatRef);
  const currentUnread = (cur.data()?.unread?.[msg.receiver] as number | undefined) ?? 0;
  await updateDoc(chatRef, {
    lastMessage: { preview, sender: msg.sender, type: msg.type },
    lastMessageAt: serverTimestamp(),
    [`unread.${msg.receiver}`]: currentUnread + 1,
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

// ============================================================
// Username uniqueness
// ============================================================

/** Returns true if the username is available (or already owned by selfUid). */
export async function isUsernameAvailable(username: string, selfUid: string): Promise<boolean> {
  const uname = username.trim().toLowerCase();
  if (!uname) return false;
  const snap = await getDocs(
    query(collection(db, "users"), where("username", "==", uname), limit(2)),
  );
  return snap.docs.every((d) => d.id === selfUid);
}

// ============================================================
// Friend requests
// Storage: friendRequests/{fromUid}_{toUid} = { from, to, status, createdAt }
// ============================================================

export interface FriendRequestDoc {
  from: string;
  to: string;
  status: "pending" | "accepted" | "declined";
  createdAt?: unknown;
  fromProfile?: { displayName: string; username: string; photoURL: string };
}

export function requestId(from: string, to: string) {
  return `${from}_${to}`;
}

export async function sendFriendRequest(
  from: string,
  to: string,
  fromProfile: { displayName: string; username: string; photoURL: string },
): Promise<void> {
  if (from === to) throw new Error("You can't friend yourself.");
  // Check reverse (they already sent to me) → auto-accept
  const reverse = await getDoc(doc(db, "friendRequests", requestId(to, from)));
  if (reverse.exists() && (reverse.data() as FriendRequestDoc).status === "pending") {
    await acceptFriendRequest(from, to);
    return;
  }
  const ref = doc(db, "friendRequests", requestId(from, to));
  const existing = await getDoc(ref).catch(() => null);
  if (existing?.exists()) {
    const data = existing.data() as FriendRequestDoc;
    if (data.status === "pending") throw new Error("Request already sent.");
  }
  await setDoc(ref, {
    from,
    to,
    status: "pending",
    fromProfile,
    createdAt: serverTimestamp(),
  } satisfies FriendRequestDoc);
}

export async function acceptFriendRequest(selfUid: string, otherUid: string): Promise<string> {
  // The pending request is from otherUid → selfUid
  const ref = doc(db, "friendRequests", requestId(otherUid, selfUid));
  await updateDoc(ref, { status: "accepted" }).catch(async () => {
    // If update fails (e.g. it's actually the other direction), try opposite.
    await updateDoc(doc(db, "friendRequests", requestId(selfUid, otherUid)), {
      status: "accepted",
    });
  });
  const chatId = await ensureChat(selfUid, otherUid);
  // Clean up: remove request doc after acceptance
  await deleteDoc(ref).catch(() => {});
  return chatId;
}

export async function declineFriendRequest(selfUid: string, otherUid: string): Promise<void> {
  await deleteDoc(doc(db, "friendRequests", requestId(otherUid, selfUid))).catch(() => {});
}
