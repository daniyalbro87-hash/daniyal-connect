import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuthStore } from "../lib/auth-store";
import { chatIdFor, createInviteCode, ensureChat, resolveInviteCode } from "../lib/chat";

type Mode = "menu" | "create" | "join";

export function InviteModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("menu");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!user) return null;

  const handleCreate = async () => {
    setBusy(true); setError(null);
    try {
      const c = await createInviteCode(user.uid);
      setCode(c);
      setMode("create");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create code.");
    } finally { setBusy(false); }
  };

  const handleJoin = async () => {
    setBusy(true); setError(null);
    try {
      const ownerUid = await resolveInviteCode(joinCode, user.uid);
      await ensureChat(user.uid, ownerUid);
      const id = chatIdFor(user.uid, ownerUid);
      onClose();
      navigate({ to: "/chat/$chatId", params: { chatId: id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join chat.");
    } finally { setBusy(false); }
  };

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/40 backdrop-blur-sm animate-fade-up" onClick={onClose}>
      <div
        className="w-full sm:max-w-sm sm:m-4 glass rounded-t-3xl sm:rounded-3xl p-5 shadow-soft animate-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {mode === "menu" && (
          <>
            <div className="text-lg font-bold mb-1">New Chat</div>
            <div className="text-sm text-muted-foreground mb-4">Create a code to share, or join with a friend's code.</div>
            <div className="grid gap-2">
              <button
                disabled={busy}
                onClick={handleCreate}
                className="w-full text-left px-4 py-3 rounded-2xl gradient-brand text-white font-semibold shadow-glow disabled:opacity-60"
              >
                {busy ? "Creating…" : "➕  Create Chat"}
              </button>
              <button
                onClick={() => { setError(null); setMode("join"); }}
                className="w-full text-left px-4 py-3 rounded-2xl bg-surface font-semibold hover:shadow-soft transition"
              >
                🔑  Join Chat
              </button>
              <button onClick={onClose} className="w-full mt-1 px-4 py-2 text-sm text-muted-foreground">Cancel</button>
            </div>
          </>
        )}

        {mode === "create" && (
          <>
            <div className="text-lg font-bold mb-1">Your invite code</div>
            <div className="text-sm text-muted-foreground mb-4">Share this code. When someone joins, your chat opens automatically.</div>
            <div className="rounded-2xl bg-surface p-4 text-center mb-3">
              <div className="text-3xl font-black tracking-[0.35em] text-gradient-brand select-all">{code}</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={copyCode} className="px-4 py-3 rounded-2xl bg-surface font-semibold hover:shadow-soft transition">
                {copied ? "Copied ✓" : "Copy"}
              </button>
              <button onClick={onClose} className="px-4 py-3 rounded-2xl gradient-brand text-white font-semibold shadow-glow">Done</button>
            </div>
          </>
        )}

        {mode === "join" && (
          <>
            <div className="text-lg font-bold mb-1">Enter invite code</div>
            <div className="text-sm text-muted-foreground mb-4">Paste the code your friend shared with you.</div>
            <input
              value={joinCode}
              onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setError(null); }}
              placeholder="ABC1234"
              maxLength={12}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="w-full bg-surface rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary/40 text-center text-xl tracking-[0.35em] font-bold uppercase"
            />
            {error && <div className="mt-2 text-sm text-destructive text-center">{error}</div>}
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button onClick={() => { setError(null); setMode("menu"); }} className="px-4 py-3 rounded-2xl bg-surface font-semibold">Back</button>
              <button
                disabled={busy || !joinCode.trim()}
                onClick={handleJoin}
                className="px-4 py-3 rounded-2xl gradient-brand text-white font-semibold shadow-glow disabled:opacity-60"
              >
                {busy ? "Joining…" : "Join"}
              </button>
            </div>
          </>
        )}

        {mode !== "join" && error && <div className="mt-3 text-sm text-destructive text-center">{error}</div>}
      </div>
    </div>
  );
}
