import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import { chatIdFor } from "./chat";

// Read TURN config from Vite env (VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL).
// STUN servers are always included as a fallback so calls work on the same network
// even when TURN isn't configured yet.
function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
  ];
  const url = import.meta.env.VITE_TURN_URL as string | undefined;
  const username = import.meta.env.VITE_TURN_USERNAME as string | undefined;
  const credential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;
  if (url && username && credential) {
    // Support comma-separated URLs
    const urls = url.split(",").map((u) => u.trim()).filter(Boolean);
    servers.push({ urls, username, credential });
  }
  return servers;
}

export type CallStatus = "ringing" | "accepted" | "declined" | "ended";
export interface CallDoc {
  caller: string;
  callee: string;
  status: CallStatus;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  callerProfile?: { displayName: string; photoURL: string; username: string };
  createdAt?: unknown;
}

export function callIdFor(a: string, b: string) {
  return `${chatIdFor(a, b)}__${Date.now()}`;
}

export interface RtcSession {
  callId: string;
  pc: RTCPeerConnection;
  localStream: MediaStream;
  remoteStream: MediaStream;
  /** Latest known status — replayed to newly-attached onStatus subscribers. */
  currentStatus: CallStatus;
  hangup: () => Promise<void>;
  onRemoteTrack: (cb: (stream: MediaStream) => void) => void;
  onStatus: (cb: (s: CallStatus) => void) => void;
  restartIce: () => Promise<void>;
}

/** Request mic with a clear error the UI can surface. */
async function getMic(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone is not available in this browser.");
  }
  // Proactive permission probe (best-effort — Safari lacks this API)
  try {
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (perms?.query) {
      const status = await perms.query({ name: "microphone" as PermissionName });
      if (status.state === "denied") {
        throw new Error(
          "Microphone permission is blocked. Enable it in your browser/site settings, then try again.",
        );
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Microphone permission")) throw e;
    // ignore probe errors — fall through to getUserMedia
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (e) {
    const err = e as DOMException;
    if (err.name === "NotAllowedError" || err.name === "SecurityError") {
      throw new Error("Microphone access denied. Please allow microphone in your browser settings.");
    }
    if (err.name === "NotFoundError") throw new Error("No microphone found on this device.");
    if (err.name === "NotReadableError") throw new Error("Microphone is in use by another app.");
    throw new Error(err.message || "Could not access microphone.");
  }
}

function attachIceCollectors(pc: RTCPeerConnection, callId: string, side: "caller" | "callee") {
  const col = collection(db, "calls", callId, side === "caller" ? "offerCandidates" : "answerCandidates");
  pc.onicecandidate = (e) => {
    if (e.candidate) addDoc(col, e.candidate.toJSON()).catch(() => {});
  };
}

function watchRemoteCandidates(pc: RTCPeerConnection, callId: string, side: "caller" | "callee") {
  const remoteCol = collection(
    db,
    "calls",
    callId,
    side === "caller" ? "answerCandidates" : "offerCandidates",
  );
  return onSnapshot(remoteCol, (snap) => {
    snap.docChanges().forEach((ch) => {
      if (ch.type === "added") {
        pc.addIceCandidate(new RTCIceCandidate(ch.doc.data() as RTCIceCandidateInit)).catch(() => {});
      }
    });
  });
}

export async function startOutgoingCall(params: {
  caller: string;
  callee: string;
  callerProfile: { displayName: string; photoURL: string; username: string };
}): Promise<RtcSession> {
  const callId = callIdFor(params.caller, params.callee);
  const callRef = doc(db, "calls", callId);
  const iceServers = buildIceServers();
  const pc = new RTCPeerConnection({ iceServers });
  const localStream = await getMic();
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  const remoteStream = new MediaStream();

  const remoteCbs = new Set<(s: MediaStream) => void>();
  const statusCbs = new Set<(s: CallStatus) => void>();
  const session: RtcSession = {
    callId,
    pc,
    localStream,
    remoteStream,
    currentStatus: "ringing",
    hangup: async () => {},
    onRemoteTrack: (cb) => {
      remoteCbs.add(cb);
      // Replay if tracks already arrived
      if (remoteStream.getTracks().length) cb(remoteStream);
    },
    onStatus: (cb) => {
      statusCbs.add(cb);
      cb(session.currentStatus);
    },
    restartIce: async () => {
      const o = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(o);
      await updateDoc(callRef, { offer: { type: o.type, sdp: o.sdp } });
    },
  };

  pc.ontrack = (e) => {
    e.streams[0].getTracks().forEach((t) => {
      if (!remoteStream.getTracks().find((x) => x.id === t.id)) remoteStream.addTrack(t);
    });
    remoteCbs.forEach((cb) => cb(remoteStream));
  };

  attachIceCollectors(pc, callId, "caller");

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await setDoc(callRef, {
    caller: params.caller,
    callee: params.callee,
    status: "ringing",
    offer: { type: offer.type, sdp: offer.sdp },
    callerProfile: params.callerProfile,
    createdAt: serverTimestamp(),
  } satisfies CallDoc);

  const unsubCall = onSnapshot(callRef, async (s) => {
    const data = s.data() as CallDoc | undefined;
    if (!data) return;
    if (data.status !== session.currentStatus) {
      session.currentStatus = data.status;
      statusCbs.forEach((cb) => cb(data.status));
    }
    if (data.answer && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer)).catch(() => {});
    }
  });
  const unsubIce = watchRemoteCandidates(pc, callId, "caller");

  let restartedOnce = false;
  pc.oniceconnectionstatechange = async () => {
    if (pc.iceConnectionState === "disconnected" && !restartedOnce) {
      restartedOnce = true;
      try {
        const restart = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(restart);
        await updateDoc(callRef, { offer: { type: restart.type, sdp: restart.sdp } });
      } catch { /* ignore */ }
    }
    if (pc.iceConnectionState === "failed") {
      session.currentStatus = "ended";
      statusCbs.forEach((cb) => cb("ended"));
    }
  };

  session.hangup = async () => {
    try { pc.getSenders().forEach((s) => s.track && s.track.stop()); } catch { /* ignore */ }
    try { pc.close(); } catch { /* ignore */ }
    localStream.getTracks().forEach((t) => t.stop());
    unsubCall();
    unsubIce();
    // Fire-and-forget: update Firestore immediately so the other side ends fast
    updateDoc(callRef, { status: "ended" }).catch(() => {});
    setTimeout(() => { deleteDoc(callRef).catch(() => {}); }, 15_000);
  };

  return session;
}

export async function acceptIncomingCall(callId: string): Promise<RtcSession> {
  const callRef = doc(db, "calls", callId);
  const snap = await getDoc(callRef);
  const data = snap.data() as CallDoc | undefined;
  if (!data?.offer) throw new Error("Call is no longer available.");

  const iceServers = buildIceServers();
  const pc = new RTCPeerConnection({ iceServers });
  const localStream = await getMic();
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  const remoteStream = new MediaStream();

  const remoteCbs = new Set<(s: MediaStream) => void>();
  const statusCbs = new Set<(s: CallStatus) => void>();
  const session: RtcSession = {
    callId,
    pc,
    localStream,
    remoteStream,
    currentStatus: "accepted",
    hangup: async () => {},
    onRemoteTrack: (cb) => {
      remoteCbs.add(cb);
      if (remoteStream.getTracks().length) cb(remoteStream);
    },
    onStatus: (cb) => {
      statusCbs.add(cb);
      cb(session.currentStatus);
    },
    restartIce: async () => { /* only caller restarts */ },
  };

  pc.ontrack = (e) => {
    e.streams[0].getTracks().forEach((t) => {
      if (!remoteStream.getTracks().find((x) => x.id === t.id)) remoteStream.addTrack(t);
    });
    remoteCbs.forEach((cb) => cb(remoteStream));
  };
  attachIceCollectors(pc, callId, "callee");

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await updateDoc(callRef, {
    status: "accepted",
    answer: { type: answer.type, sdp: answer.sdp },
  });

  const unsubCall = onSnapshot(callRef, (s) => {
    const d = s.data() as CallDoc | undefined;
    if (d && d.status !== session.currentStatus) {
      session.currentStatus = d.status;
      statusCbs.forEach((cb) => cb(d.status));
    }
  });
  const unsubIce = watchRemoteCandidates(pc, callId, "callee");

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "failed") {
      session.currentStatus = "ended";
      statusCbs.forEach((cb) => cb("ended"));
    }
  };

  session.hangup = async () => {
    try { pc.getSenders().forEach((s) => s.track && s.track.stop()); } catch { /* ignore */ }
    try { pc.close(); } catch { /* ignore */ }
    localStream.getTracks().forEach((t) => t.stop());
    unsubCall();
    unsubIce();
    updateDoc(callRef, { status: "ended" }).catch(() => {});
  };

  return session;
}

export async function declineCall(callId: string) {
  // Fire-and-forget so the UI closes instantly
  updateDoc(doc(db, "calls", callId), { status: "declined" }).catch(() => {});
  setTimeout(() => { deleteDoc(doc(db, "calls", callId)).catch(() => {}); }, 10_000);
}

/**
 * Combine local + remote audio tracks into a single MediaStream (for MediaRecorder).
 */
export function mixAudio(local: MediaStream, remote: MediaStream): { mixed: MediaStream; ctx: AudioContext } {
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const dest = ctx.createMediaStreamDestination();
  try { ctx.createMediaStreamSource(local).connect(dest); } catch { /* ignore */ }
  try { ctx.createMediaStreamSource(remote).connect(dest); } catch { /* ignore */ }
  return { mixed: dest.stream, ctx };
}
