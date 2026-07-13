import { create } from "zustand";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "./firebase";

export type ThemeMode = "light" | "dark" | "system";

export interface UserSettings {
  theme: ThemeMode;
  readReceipts: boolean;
  notifications: boolean;
  wallpaper: string; // key from PRESET_WALLPAPERS or a raw color/gradient
  lastBackupAt?: number | null;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  readReceipts: true,
  notifications: true,
  wallpaper: "aurora",
  lastBackupAt: null,
};

export const PRESET_WALLPAPERS: Record<string, { label: string; css: string }> = {
  aurora: {
    label: "Aurora",
    css: "radial-gradient(1200px 600px at 10% -10%, oklch(0.88 0.09 260 / 0.55), transparent 60%), radial-gradient(1000px 500px at 100% 10%, oklch(0.88 0.09 310 / 0.45), transparent 60%), linear-gradient(180deg, oklch(0.985 0.005 260) 0%, oklch(0.97 0.015 265) 100%)",
  },
  ocean: {
    label: "Ocean",
    css: "linear-gradient(180deg, oklch(0.95 0.04 230) 0%, oklch(0.92 0.06 250) 100%)",
  },
  sunset: {
    label: "Sunset",
    css: "linear-gradient(180deg, oklch(0.95 0.05 40) 0%, oklch(0.90 0.09 20) 100%)",
  },
  mint: {
    label: "Mint",
    css: "linear-gradient(180deg, oklch(0.96 0.04 160) 0%, oklch(0.93 0.06 170) 100%)",
  },
  midnight: {
    label: "Midnight",
    css: "linear-gradient(180deg, oklch(0.22 0.04 265) 0%, oklch(0.16 0.04 275) 100%)",
  },
  paper: {
    label: "Paper",
    css: "linear-gradient(180deg, oklch(0.99 0.005 90) 0%, oklch(0.97 0.008 90) 100%)",
  },
};

interface SettingsStore {
  settings: UserSettings;
  uid: string | null;
  unsub: (() => void) | null;
  bind: (uid: string) => void;
  unbind: () => void;
  update: (patch: Partial<UserSettings>) => Promise<void>;
}

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const isDark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

function applyWallpaper(key: string) {
  if (typeof document === "undefined") return;
  const preset = PRESET_WALLPAPERS[key];
  if (preset) document.documentElement.style.setProperty("--chat-wallpaper", preset.css);
}

// Watch system theme changes when in "system" mode
if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const s = useSettingsStore.getState().settings;
    if (s.theme === "system") applyTheme("system");
  });
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  uid: null,
  unsub: null,
  bind: (uid: string) => {
    if (get().uid === uid && get().unsub) return;
    get().unsub?.();
    const unsub = onSnapshot(doc(db, "users", uid), (snap) => {
      const data = snap.data() as { settings?: Partial<UserSettings> } | undefined;
      const merged: UserSettings = { ...DEFAULT_SETTINGS, ...(data?.settings || {}) };
      set({ settings: merged });
      applyTheme(merged.theme);
      applyWallpaper(merged.wallpaper);
    });
    set({ uid, unsub });
  },
  unbind: () => {
    get().unsub?.();
    set({ uid: null, unsub: null });
  },
  update: async (patch) => {
    const { uid, settings } = get();
    const next = { ...settings, ...patch };
    set({ settings: next });
    if (patch.theme) applyTheme(next.theme);
    if (patch.wallpaper) applyWallpaper(next.wallpaper);
    if (uid) {
      await updateDoc(doc(db, "users", uid), { settings: next }).catch(() => {});
    }
  },
}));
