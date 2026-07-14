# Implementation Plan

This is a large batch — I'll ship it in one pass but want you to confirm scope and the Firebase-side config you'll need to do afterward.

## What I'll build

### 1. WebRTC 1:1 Voice Calling
- New `src/lib/webrtc.ts` — `RTCPeerConnection` wrapper with Google STUN, structured so you can drop in TURN later via a single env constant.
- Firestore signaling under `calls/{callId}` with subcollections `offerCandidates` / `answerCandidates`. Call doc holds `caller`, `callee`, `status` (`ringing|accepted|declined|ended`), `offer`, `answer`, timestamps.
- New `src/components/CallOverlay.tsx` — fullscreen overlay for both outgoing ("Calling…") and incoming ("Accept / Decline") with caller avatar + name, timer once connected, mute, speaker (via `setSinkId` where supported), end call.
- New `src/lib/call-store.ts` (zustand) — global call state so the overlay renders app-wide, plus a top-level `CallListener` mounted in `_app.tsx` watching `calls` where `callee == me && status == 'ringing'`.
- Chat header gets a phone icon that starts a call (no design change beyond the icon).
- Reconnect: on `iceconnectionstatechange === 'disconnected'` attempt ICE restart once before ending.

### 2. FCM Push Notifications
- Add `firebase/messaging`. New `public/firebase-messaging-sw.js` (background handler) — separate from any app-shell SW, per PWA rules.
- New `src/lib/messaging.ts` — request permission, get token with the VAPID key you provided, save to `users/{uid}/fcmTokens/{token}`.
- Notifications for: new messages, friend requests, incoming calls. Sending requires an FCM server-side sender — I'll wire the client + token storage and document what you need to add server-side (Cloud Function or your existing backend). Without a sender, foreground alerts still work via the existing `NotificationsBridge`; I'll extend it to cover friend requests + calls too so the app works today.
- Notification click routes to `/chat/:id`, `/friends`, or opens the incoming call.

### 3. Settings → Notifications section
- Extend `_app.settings.tsx`: Enable Notifications button (triggers permission + token registration), live permission status, Test Notification button, and a clear "how to enable" hint when `Notification.permission === 'denied'`.
- Add Call Recording toggle to settings store.

### 4. PWA polish
- Register `firebase-messaging-sw.js` at `/firebase-messaging-sw.js` scope. Keep separate from any app-shell SW.
- iOS: existing `IOSInstallGuide` stays; add `apple-mobile-web-app-capable` meta already present — verify.
- Confirm manifest has correct icons/theme; already present.

### 5. Local Call Recording
- When toggle is ON, capture `MediaStreamDestination` mixing local mic + remote audio via `MediaRecorder` (webm/opus).
- On call end, prompt a download via a Blob URL. Never uploaded anywhere.

### 6. Dashboard loading fix
- Root cause candidates in `_app.chats.tsx`: listener depends on `user.uid` but effect may fire before auth store hydrates, or query fails silently on empty `participants`. Fix by:
  - Gating the subscribe effect on `!loading && user`.
  - Showing an explicit skeleton until first snapshot arrives (not just empty state).
  - Retrying once on `permission-denied` after auth token refresh.

### 7. Friend request fix
- Audit `sendFriendRequest` — current code does a `getDoc` on a request that may not exist under strict rules (permission-denied bubbles up). Switch pre-check to a query on `from+to` OR wrap the read in try/catch and fall through to create.
- Ensure `fromProfile` fields are never `undefined` (Firestore rejects).
- Show toast on success/failure.
- Requests page (`_app.friends.tsx`) — verify realtime listener is bound correctly; add loading state.

### 9. Security preserved
- No rule relaxation. I'll list the exact rule additions you need for `calls/{callId}` + `users/{uid}/fcmTokens/{token}` so you can paste them into your Firestore rules.

## What you need to do after I ship

1. **Firestore rules** — I'll print the additions for `calls`, `users/{uid}/fcmTokens`, and any tightened `friendRequests` rules.
2. **FCM server sender** — client tokens will be saved; to actually deliver push while the app is closed you need a small server (Cloud Function or your backend) that reads tokens and calls FCM HTTP v1. I'll include a ready-to-deploy `functions/sendPush.ts` template.
3. **Firebase console** — enable Cloud Messaging API (already enabled if you generated the VAPID key), keep Google Auth settings unchanged.

## Not included (out of scope, please confirm if you want them)
- CallKit-style native ringing on iOS PWA — browsers don't allow it; I'll use best-effort in-app ringtone + notification.
- TURN server provisioning — code is TURN-ready but you'll need to supply credentials (e.g., Twilio, Metered) when you're ready.

Confirm and I'll implement everything above in one pass.