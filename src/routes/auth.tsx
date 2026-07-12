import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuthStore } from "../lib/auth-store";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — Daniyal Chat" }] }),
  component: AuthPage,
});

function AuthPage() {
  const { user, loading, signInGoogle } = useAuthStore();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/chats", replace: true });
  }, [user, loading, navigate]);

  const handleSignIn = async () => {
    setBusy(true); setErr(null);
    try { await signInGoogle(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Sign-in failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md glass rounded-3xl p-8 shadow-soft animate-pop">
        <div className="flex flex-col items-center text-center">
          <img src="/icon-512.png" alt="Daniyal Chat" className="w-20 h-20 rounded-3xl shadow-glow" />
          <h1 className="mt-5 text-3xl font-bold">
            Welcome to <span className="text-gradient-brand">Daniyal Chat</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Premium realtime messaging. Photos, videos, voice notes & files — all in one beautiful app.
          </p>
          <button
            onClick={handleSignIn}
            disabled={busy}
            className="mt-8 w-full inline-flex items-center justify-center gap-3 rounded-2xl bg-white text-gray-800 font-semibold px-5 py-3 shadow-soft hover:shadow-glow transition disabled:opacity-60"
          >
            <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.1-11.3-7.6l-6.5 5C9.5 39.5 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2C40.9 35.5 44 30.2 44 24c0-1.3-.1-2.3-.4-3.5z"/></svg>
            {busy ? "Signing in…" : "Continue with Google"}
          </button>
          {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
          <p className="mt-6 text-xs text-muted-foreground">
            By continuing you agree to our friendly terms. No spam. Ever.
          </p>
        </div>
      </div>
    </div>
  );
}
