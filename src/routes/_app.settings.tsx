import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuthStore } from "../lib/auth-store";
import { useSettingsStore, PRESET_WALLPAPERS, type ThemeMode } from "../lib/settings-store";
import { BottomNav } from "../components/BottomNav";
import { format } from "date-fns";
import { enablePushNotifications, permissionState, sendTestNotification, type PermState } from "../lib/messaging";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — Daniyal Chat" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, profile, logout } = useAuthStore();
  const navigate = useNavigate();
  const { settings, update } = useSettingsStore();
  const [backingUp, setBackingUp] = useState(false);

  if (!user || !profile) return null;

  const doBackup = async () => {
    setBackingUp(true);
    await new Promise((r) => setTimeout(r, 800));
    await update({ lastBackupAt: Date.now() });
    setBackingUp(false);
  };

  return (
    <div className="min-h-[100dvh] mx-auto w-full max-w-2xl px-4 pt-6 pb-32 overflow-x-hidden">
      <header className="flex items-center gap-3 mb-6">
        <Link
          to="/chats"
          className="p-2 rounded-full glass hover:shadow-glow transition"
          aria-label="Back"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold">Settings</h1>
      </header>

      {/* Profile card */}
      <Link
        to="/profile"
        className="glass rounded-3xl p-4 shadow-soft flex items-center gap-4 mb-4 hover:shadow-glow transition"
      >
        {profile.photoURL ? (
          <img src={profile.photoURL} alt="" className="w-16 h-16 rounded-2xl object-cover" />
        ) : (
          <div className="w-16 h-16 rounded-2xl gradient-brand grid place-items-center text-white text-2xl font-bold">
            {profile.displayName[0]?.toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{profile.displayName}</div>
          <div className="text-xs text-muted-foreground truncate">@{profile.username}</div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">{profile.bio}</div>
        </div>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-muted-foreground shrink-0"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </Link>

      {/* Appearance */}
      <Section title="Appearance">
        <Row label="Theme">
          <div className="flex gap-1 rounded-xl bg-muted p-1">
            {(["light", "dark", "system"] as ThemeMode[]).map((m) => (
              <button
                key={m}
                onClick={() => update({ theme: m })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                  settings.theme === m ? "bg-surface shadow-soft" : "text-muted-foreground"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Chat wallpaper" stack>
          <div className="grid grid-cols-3 gap-2 w-full mt-2">
            {Object.entries(PRESET_WALLPAPERS).map(([key, w]) => (
              <button
                key={key}
                onClick={() => update({ wallpaper: key })}
                className={`h-16 rounded-2xl border-2 transition ${
                  settings.wallpaper === key ? "border-primary shadow-glow" : "border-transparent"
                }`}
                style={{ background: w.css }}
                aria-label={w.label}
              >
                <span className="sr-only">{w.label}</span>
              </button>
            ))}
          </div>
        </Row>
      </Section>

      {/* Privacy */}
      <Section title="Privacy">
        <Toggle
          label="Read receipts"
          hint="Show ✓✓ when you've read a message"
          value={settings.readReceipts}
          onChange={(v) => update({ readReceipts: v })}
        />
        <Toggle
          label="Notifications"
          hint="Show in-app alerts for new messages"
          value={settings.notifications}
          onChange={(v) => update({ notifications: v })}
        />
      </Section>

      {/* Chat backup */}
      <Section title="Chat Backup">
        <div className="p-4 rounded-2xl bg-surface space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Last backup</div>
              <div className="text-xs text-muted-foreground">
                {settings.lastBackupAt ? format(new Date(settings.lastBackupAt), "PPpp") : "Never"}
              </div>
            </div>
            <button
              onClick={doBackup}
              disabled={backingUp}
              className="shrink-0 px-4 py-2 rounded-xl gradient-brand text-white text-sm font-semibold shadow-glow disabled:opacity-60"
            >
              {backingUp ? "Backing up…" : "Back up now"}
            </button>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Backups are prepared for restore in a future update. Your chats stay encrypted in
            Lovable Cloud (Firestore).
          </div>
        </div>
      </Section>

      {/* Account */}
      <Section title="Account">
        <button
          onClick={async () => {
            await logout();
            navigate({ to: "/auth", replace: true });
          }}
          className="w-full py-3 rounded-2xl bg-destructive/10 text-destructive font-semibold hover:bg-destructive/15 transition"
        >
          Log out
        </button>
      </Section>

      <BottomNav />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground px-2 mb-2">{title}</div>
      <div className="glass rounded-3xl p-2 shadow-soft space-y-1">{children}</div>
    </section>
  );
}

function Row({
  label,
  children,
  stack,
}: {
  label: string;
  children: React.ReactNode;
  stack?: boolean;
}) {
  return (
    <div className={`p-3 ${stack ? "" : "flex items-center justify-between gap-3"}`}>
      <div className="text-sm font-medium">{label}</div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="w-full flex items-center justify-between gap-3 p-3 rounded-2xl hover:bg-muted/40 transition text-left"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <span
        className={`w-11 h-6 rounded-full relative transition shrink-0 ${value ? "gradient-brand" : "bg-muted"}`}
        aria-checked={value}
        role="switch"
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition ${
            value ? "left-[calc(100%-1.375rem)]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
