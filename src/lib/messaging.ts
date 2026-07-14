import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { app, db } from "./firebase";

export const VAPID_KEY =
  "BHlQ9vI0yUMk4JYPeuiMYfVzIaHJXtoZGRbpC9kQba56P3bBz7xntLRduacWS9-HRz5bNsUKgCbhUbCLwYogq9U";

export type PermState = "default" | "granted" | "denied" | "unsupported";

export function permissionState(): PermState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as PermState;
}

async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
  } catch (e) {
    console.warn("SW register failed", e);
    return null;
  }
}

export async function enablePushNotifications(uid: string): Promise<{ token: string | null; permission: PermState }> {
  if (typeof window === "undefined") return { token: null, permission: "unsupported" };
  if (!("Notification" in window)) return { token: null, permission: "unsupported" };

  let permission = Notification.permission as PermState;
  if (permission === "default") {
    permission = (await Notification.requestPermission()) as PermState;
  }
  if (permission !== "granted") return { token: null, permission };

  const supported = await isSupported().catch(() => false);
  if (!supported) return { token: null, permission };

  const reg = await registerSW();
  if (!reg) return { token: null, permission };

  const messaging = getMessaging(app);
  try {
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg,
    });
    if (token) {
      await setDoc(
        doc(db, "users", uid, "fcmTokens", token),
        { token, platform: navigator.userAgent, createdAt: serverTimestamp() },
        { merge: true },
      );
    }
    // Foreground messages
    onMessage(messaging, (payload) => {
      const title = payload.notification?.title || "Daniyal Chat";
      const body = payload.notification?.body || "";
      if (Notification.permission === "granted") {
        try {
          new Notification(title, { body, icon: "/icon-512.png" });
        } catch { /* ignore */ }
      }
    });
    return { token, permission };
  } catch (e) {
    console.warn("FCM getToken failed", e);
    return { token: null, permission };
  }
}

export async function sendTestNotification() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (reg) {
    reg.showNotification("Daniyal Chat", {
      body: "🎉 Notifications are working!",
      icon: "/icon-512.png",
      badge: "/icon-512.png",
      tag: "test",
    });
  } else {
    new Notification("Daniyal Chat", { body: "🎉 Notifications are working!", icon: "/icon-512.png" });
  }
}
