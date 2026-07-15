import { create } from "zustand";
import type { User } from "firebase/auth";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider, db } from "./firebase";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string;
  username: string;
  bio: string;
  photoURL: string;
  createdAt?: unknown;
}

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  init: () => void;
  signInGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

let initialized = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  loading: true,
  init: () => {
    if (initialized || typeof window === "undefined") return;
    initialized = true;
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        set({ user: null, profile: null, loading: false });
        return;
      }
      // Unblock the UI immediately — profile hydrates in the background.
      set({ user, loading: false });
      const ref = doc(db, "users", user.uid);
      const snap = await getDoc(ref);
      let profile: UserProfile;
      if (!snap.exists()) {
        const base: UserProfile = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || "New User",
          username: (user.email?.split("@")[0] || `user${Date.now()}`).toLowerCase().replace(/[^a-z0-9_]/g, ""),
          bio: "Hey there! I'm using Daniyal Chat.",
          photoURL: user.photoURL || "",
        };
        await setDoc(ref, {
          ...base,
          createdAt: serverTimestamp(),
          presence: { online: true, lastSeen: serverTimestamp() },
        });
        profile = base;
      } else {
        profile = { uid: user.uid, ...(snap.data() as Omit<UserProfile, "uid">) };
        updateDoc(ref, { "presence.online": true, "presence.lastSeen": serverTimestamp() }).catch(() => {});
      }
      set({ profile });

      // Presence heartbeat + offline on unload
      const heartbeat = setInterval(() => {
        updateDoc(ref, { "presence.lastSeen": serverTimestamp(), "presence.online": true }).catch(() => {});
      }, 25_000);
      const goOffline = () => {
        updateDoc(ref, { "presence.online": false, "presence.lastSeen": serverTimestamp() }).catch(() => {});
      };
      window.addEventListener("beforeunload", goOffline);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") goOffline();
        else updateDoc(ref, { "presence.online": true, "presence.lastSeen": serverTimestamp() }).catch(() => {});
      });
      (window as unknown as { __dcCleanup?: () => void }).__dcCleanup = () => {
        clearInterval(heartbeat);
        window.removeEventListener("beforeunload", goOffline);
      };
    });
  },
  signInGoogle: async () => {
    await signInWithPopup(auth, googleProvider);
  },
  logout: async () => {
    const { user } = get();
    if (user) {
      await updateDoc(doc(db, "users", user.uid), {
        "presence.online": false,
        "presence.lastSeen": serverTimestamp(),
      }).catch(() => {});
    }
    await signOut(auth);
  },
  refreshProfile: async () => {
    const u = get().user;
    if (!u) return;
    const snap = await getDoc(doc(db, "users", u.uid));
    if (snap.exists()) set({ profile: { uid: u.uid, ...(snap.data() as Omit<UserProfile, "uid">) } });
  },
}));
