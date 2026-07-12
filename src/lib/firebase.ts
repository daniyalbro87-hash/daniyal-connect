import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, browserLocalPersistence, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// NOTE: Firebase Auth + Firestore ONLY. No Firebase Storage. All media -> Cloudinary.
const firebaseConfig = {
  apiKey: "AIzaSyBi9Fky384axSi5s38Y7w0YpIfd5BtdG5E",
  authDomain: "daniyal-chat-de390.firebaseapp.com",
  projectId: "daniyal-chat-de390",
  messagingSenderId: "639500090169",
  appId: "1:639500090169:web:a5e43044fce21830c006e8",
  measurementId: "G-Y3V9VMHF77",
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

if (typeof window !== "undefined") {
  setPersistence(auth, browserLocalPersistence).catch(() => {});
}
