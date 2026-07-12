import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuthStore } from "../lib/auth-store";
import { uploadToCloudinary } from "../lib/cloudinary";

export const Route = createFileRoute("/_app/profile")({
  head: () => ({ meta: [{ title: "Profile — Daniyal Chat" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, profile, refreshProfile } = useAuthStore();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(profile?.displayName || "");
  const [username, setUsername] = useState(profile?.username || "");
  const [bio, setBio] = useState(profile?.bio || "");
  const [photoURL, setPhotoURL] = useState(profile?.photoURL || "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!user || !profile) return null;

  const onPickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setUploading(true);
    try {
      const res = await uploadToCloudinary(f);
      setPhotoURL(res.secure_url);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Upload failed");
    } finally { setUploading(false); }
  };

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const uname = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
      await updateDoc(doc(db, "users", user.uid), {
        displayName: displayName.trim() || "User",
        username: uname || profile.username,
        bio: bio.trim(),
        photoURL,
      });
      await refreshProfile();
      setMsg("Saved ✓");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="min-h-screen mx-auto max-w-xl px-4 pt-6 pb-16">
      <header className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate({ to: "/chats" })} className="p-2 rounded-full glass hover:shadow-glow transition">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 className="text-2xl font-bold">Your profile</h1>
      </header>

      <div className="glass rounded-3xl p-6 shadow-soft space-y-5">
        <div className="flex flex-col items-center">
          <div className="relative">
            {photoURL ? (
              <img src={photoURL} alt="" className="w-28 h-28 rounded-full object-cover ring-4 ring-white shadow-glow" />
            ) : (
              <div className="w-28 h-28 rounded-full gradient-brand grid place-items-center text-white text-4xl font-bold shadow-glow">
                {displayName[0]?.toUpperCase() || "U"}
              </div>
            )}
            <label className="absolute -bottom-1 -right-1 gradient-brand text-white rounded-full p-2 cursor-pointer shadow-glow hover:scale-105 transition">
              <input type="file" accept="image/*" className="hidden" onChange={onPickAvatar} />
              {uploading ? (
                <span className="text-xs px-1">…</span>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14"/></svg>
              )}
            </label>
          </div>
        </div>

        <Field label="Display name">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="input" />
        </Field>
        <Field label="Username" hint="letters, numbers, underscores">
          <input value={username} onChange={(e) => setUsername(e.target.value)} className="input" />
        </Field>
        <Field label="Bio">
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className="input resize-none" />
        </Field>

        <button
          onClick={save} disabled={saving}
          className="w-full rounded-2xl gradient-brand text-white font-semibold py-3 shadow-glow disabled:opacity-60"
        >{saving ? "Saving…" : "Save changes"}</button>
        {msg && <div className="text-center text-sm text-muted-foreground">{msg}</div>}
      </div>

      <style>{`.input { width:100%; background:var(--color-surface); border:1px solid var(--color-border); border-radius:1rem; padding:.75rem 1rem; outline:none; }
        .input:focus { box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-primary) 25%, transparent); border-color: var(--color-primary); }`}</style>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
