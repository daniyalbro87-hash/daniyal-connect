# Daniyal Chat — Implementation Plan

A premium WhatsApp/Telegram-style chat PWA built on **Firebase (Auth + Firestore only)** and **Cloudinary** (all media). No Firebase Storage anywhere. No Lovable Cloud/Supabase.

This is a large build. I'll deliver it in **3 sequenced phases** in this same project — each phase leaves the app fully working, and I move to the next automatically unless you say stop.

---

## Phase 1 — Foundation & Core Chat (first delivery)

**Infra**
- Add `firebase` SDK, wire `src/lib/firebase.ts` with the provided config (Auth + Firestore only; no `storageBucket`).
- Add `.env` for `VITE_CLOUDINARY_CLOUD_NAME` and `VITE_CLOUDINARY_UPLOAD_PRESET` (unsigned preset — safe in client, no API secret).
- Design system overhaul in `src/styles.css`: soft light theme, blue→purple gradient tokens, glass surfaces, chat-bubble tokens, premium typography (Plus Jakarta Sans + Inter).
- Generate DC gradient logo (used for favicon, PWA icons, splash, navbar).
- PWA: `manifest.webmanifest`, icons (192/512/maskable), theme color, install prompt component, standalone display. (Service worker guarded per Lovable PWA rules — offline app shell only, not registered in preview.)

**Auth & Profile**
- Google Sign-In, persistent session, protected `_authenticated` layout, logout.
- Firestore `users/{uid}`: displayName, username (unique), bio, photoURL (Cloudinary), createdAt.
- Profile page: edit displayName / username / bio / avatar (avatar upload → Cloudinary).

**Home / Conversations**
- Conversation list with last message preview, unread badge, online dot, relative time.
- User search (by username/displayName) to start a new chat.

**1:1 Realtime Chat**
- Firestore schema: `chats/{chatId}` + `chats/{chatId}/messages/{msgId}`.
- Text messages, realtime `onSnapshot`, timestamps.
- Sent / Delivered / Read receipts (double-tick style).
- Typing indicator (`chats/{chatId}/typing/{uid}`).
- Presence (online / lastSeen) via `users/{uid}.presence` heartbeat + `onDisconnect`-style timeout.

---

## Phase 2 — Media & Rich Messaging

- Cloudinary unsigned upload helper (`src/lib/cloudinary.ts`) with progress.
- **Images**: single + multi-image picker, in-bubble responsive grid, fullscreen viewer with pinch-zoom & download.
- **Videos**: in-bubble preview + inline player + fullscreen.
- **Voice notes**: record (MediaRecorder), waveform preview, cancel/send, in-bubble player with seek.
- **Documents** (PDF/DOCX/TXT/ZIP/APK/…): file icon by type, size, open/download.
- Permissions handled correctly (camera, mic, files).
- Firestore messages only store `{type, secure_url, public_id, mime, size, sender, receiver, timestamp, status}`.

---

## Phase 3 — Polish, Notifications, Performance

- Unread counters + in-app toast notifications.
- Browser `Notification` API (foreground); PWA notification permission flow.
- Message list virtualization (`@tanstack/react-virtual`) for smooth long-history scrolling.
- Route-level lazy loading, image `loading="lazy"`, Cloudinary `f_auto,q_auto` transformations.
- Empty states, skeletons, error boundaries, hydration-safe reads.
- Final QA pass against the checklist in your prompt.

---

## Technical notes (for reference)

- **Routing**: TanStack Start file routes — `/auth`, `/` (chat list, protected), `/chat/$chatId`, `/profile`, `/settings`.
- **State**: Firebase listeners + small Zustand store for auth/presence; TanStack Query only where useful.
- **Deterministic chatId**: `sortedUids.join('_')` so both users resolve the same doc.
- **Security**: Cloudinary unsigned preset (no secret in client). I'll also output the recommended Firestore security rules for you to paste into the Firebase console — I can't deploy them from here.
- **Deployment**: Works on Vercel out of the box (TanStack Start build). I'll note the env vars to set there.

---

## What I need from you before I start

Just confirm two things and I'll begin Phase 1 immediately:

1. **Cloudinary upload preset** — is `Daniyal chat` configured as **Unsigned**? (Required for direct browser uploads without exposing your API secret. If not, set it to Unsigned in Cloudinary → Settings → Upload.)
2. **Firestore security rules** — OK if I hand you the rules to paste into the Firebase console yourself? (I have no access to your Firebase project.)

Reply "go" (with any adjustments) and I'll ship Phase 1.
