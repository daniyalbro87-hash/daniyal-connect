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

// Add TURN servers here later. Keep the array stable so callers don't need changes.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  // Example TURN (fill later):
  // { urls: "turn:turn.example.com:3478", username: "...", credential: "..." },
];

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
  // A single call doc per pair per session; suffix with timestamp for uniqueness
  return `${chatIdFor(a, b)}__${Date.now()}`;
}

export interface RtcSession {
  callId: string;
  pc: RTCPeerConnection;
  localStream: MediaStream;
  remoteStream: MediaStream;
  hangup: () => Promise<void>;
  onRemoteTrack: (cb: (stream: MediaStream) => void) => void;
  onStatus: (cb: (s: CallStatus) => void) => void;
  restartIce: () => Promise<void>;
}

async function getMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
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
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const localStream = await getMic();
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  const remoteStream = new MediaStream();
  let remoteCb: ((s: MediaStream) => void) | null = null;
  let statusCb: ((s: CallStatus) => void) | null = null;
  pc.ontrack = (e) => {
    e.streams[0].getTracks().forEach((t) => remoteStream.addTrack(t));
    remoteCb?.(remoteStream);
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
    statusCb?.(data.status);
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
  };

  const hangup = async () => {
    try { pc.close(); } catch { /* ignore */ }
    localStream.getTracks().forEach((t) => t.stop());
    unsubCall();
    unsubIce();
    await updateDoc(callRef, { status: "ended" }).catch(() => {});
    // Best-effort cleanup after 30s
    setTimeout(() => { deleteDoc(callRef).catch(() => {}); }, 30_000);
  };

  return {
    callId,
    pc,
    localStream,
    remoteStream,
    hangup,
    onRemoteTrack: (cb) => { remoteCb = cb; },
    onStatus: (cb) => { statusCb = cb; },
    restartIce: async () => {
      const o = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(o);
      await updateDoc(callRef, { offer: { type: o.type, sdp: o.sdp } });
    },
  };
}

export async function acceptIncomingCall(callId: string): Promise<RtcSession> {
  const callRef = doc(db, "calls", callId);
  const snap = await getDoc(callRef);
  const data = snap.data() as CallDoc | undefined;
  if (!data?.offer) throw new Error("Call is no longer available.");

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const localStream = await getMic();
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  const remoteStream = new MediaStream();
  let remoteCb: ((s: MediaStream) => void) | null = null;
  let statusCb: ((s: CallStatus) => void) | null = null;
  pc.ontrack = (e) => {
    e.streams[0].getTracks().forEach((t) => remoteStream.addTrack(t));
    remoteCb?.(remoteStream);
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
    if (d) statusCb?.(d.status);
  });
  const unsubIce = watchRemoteCandidates(pc, callId, "callee");

  const hangup = async () => {
    try { pc.close(); } catch { /* ignore */ }
    localStream.getTracks().forEach((t) => t.stop());
    unsubCall();
    unsubIce();
    await updateDoc(callRef, { status: "ended" }).catch(() => {});
  };

  return {
    callId,
    pc,
    localStream,
    remoteStream,
    hangup,
    onRemoteTrack: (cb) => { remoteCb = cb; },
    onStatus: (cb) => { statusCb = cb; },
    restartIce: async () => { /* only caller restarts */ },
  };
}

export async function declineCall(callId: string) {
  await updateDoc(doc(db, "calls", callId), { status: "declined" }).catch(() => {});
  setTimeout(() => { deleteDoc(doc(db, "calls", callId)).catch(() => {}); }, 15_000);
}

/**
 * Combine local + remote audio tracks into a single MediaStream (for MediaRecorder).
 * Runs entirely in-browser — nothing leaves the device.
 */
export function mixAudio(local: MediaStream, remote: MediaStream): { mixed: MediaStream; ctx: AudioContext } {
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const dest = ctx.createMediaStreamDestination();
  try { ctx.createMediaStreamSource(local).connect(dest); } catch { /* ignore */ }
  try { ctx.createMediaStreamSource(remote).connect(dest); } catch { /* ignore */ }
  return { mixed: dest.stream, ctx };
}
