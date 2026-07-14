import { create } from "zustand";
import type { RtcSession, CallStatus, CallDoc } from "./webrtc";

export type UIState = "idle" | "outgoing" | "incoming" | "in-call" | "ended";

interface Peer {
  uid: string;
  displayName: string;
  photoURL: string;
  username: string;
}

interface CallStoreState {
  ui: UIState;
  session: RtcSession | null;
  peer: Peer | null;
  status: CallStatus | null;
  // Incoming (pre-accept)
  incomingCallId: string | null;
  startedAt: number | null;
  set: (patch: Partial<CallStoreState>) => void;
  reset: () => void;
  setFromIncoming: (callId: string, doc: CallDoc) => void;
}

export const useCallStore = create<CallStoreState>((set) => ({
  ui: "idle",
  session: null,
  peer: null,
  status: null,
  incomingCallId: null,
  startedAt: null,
  set: (patch) => set(patch),
  reset: () =>
    set({
      ui: "idle",
      session: null,
      peer: null,
      status: null,
      incomingCallId: null,
      startedAt: null,
    }),
  setFromIncoming: (callId, d) =>
    set({
      ui: "incoming",
      incomingCallId: callId,
      peer: {
        uid: d.caller,
        displayName: d.callerProfile?.displayName || "Unknown",
        photoURL: d.callerProfile?.photoURL || "",
        username: d.callerProfile?.username || "",
      },
      status: "ringing",
    }),
}));
