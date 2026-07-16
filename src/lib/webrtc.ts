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
  callNonce?: string;
  createdAt?: unknown;
}

export function callIdFor(a: string, b: string) {
  // One active call document per 1:1 chat prevents duplicate ringing/doc spam.
  return chatIdFor(a, b);
}

function makeCallNonce() {
  const arr = new Uint32Array(2);
  crypto.getRandomValues(arr);
  return `${Date.now().toString(36)}-${arr[0].toString(36)}${arr[1].toString(36)}`;
}

type CandidateDoc = RTCIceCandidateInit & { callNonce?: string };

export interface CallDiagnostics {
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  iceGatheringState: RTCIceGatheringState;
  signalingState: RTCSignalingState;
  localAudioTracks: Array<{ id: string; enabled: boolean; readyState: MediaStreamTrackState; muted: boolean }>;
  remoteAudioTracks: Array<{ id: string; enabled: boolean; readyState: MediaStreamTrackState; muted: boolean }>;
  outboundAudio: { bytesSent: number; packetsSent: number; audioLevel?: number; totalAudioEnergy?: number };
  inboundAudio: { bytesReceived: number; packetsReceived: number; packetsLost: number; jitter?: number; audioLevel?: number; totalAudioEnergy?: number };
  selectedCandidatePair?: { state?: string; nominated?: boolean; currentRoundTripTime?: number; localCandidateType?: string; remoteCandidateType?: string; localProtocol?: string; remoteProtocol?: string };
}

export interface RtcSession {
  callId: string;
  callNonce: string;
  pc: RTCPeerConnection;
  localStream: MediaStream;
  remoteStream: MediaStream;
  /** Latest known status — replayed to newly-attached onStatus subscribers. */
  currentStatus: CallStatus;
  hangup: () => Promise<void>;
  onRemoteTrack: (cb: (stream: MediaStream) => void) => void;
  onStatus: (cb: (s: CallStatus) => void) => void;
  restartIce: () => Promise<void>;
  getDiagnostics: () => Promise<CallDiagnostics>;
}

/** Prime browser audio output from the tap/click gesture before async WebRTC work. */
export async function unlockAudioPlayback(): Promise<void> {
  if (typeof window === "undefined") return;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (AC) {
    try {
      const ctx = new AC();
      if (ctx.state === "suspended") await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.00001;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.03);
      setTimeout(() => ctx.close().catch(() => {}), 120);
    } catch { /* ignore */ }
  }
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
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    const tracks = stream.getAudioTracks();
    if (!tracks.length) throw new Error("No microphone audio track was created.");
    tracks.forEach((track) => {
      track.enabled = true;
      if (track.readyState !== "live") throw new Error("Microphone audio track is not live.");
    });
    return stream;
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

function assertAudioSdp(desc: RTCSessionDescriptionInit, label: string) {
  if (!desc.sdp || !/^m=audio\s/m.test(desc.sdp)) {
    throw new Error(`${label} did not contain an audio media section.`);
  }
}

async function getDiagnosticsFor(session: Pick<RtcSession, "pc" | "localStream" | "remoteStream">): Promise<CallDiagnostics> {
  const stats = await session.pc.getStats();
  const outboundAudio = { bytesSent: 0, packetsSent: 0, audioLevel: undefined as number | undefined, totalAudioEnergy: undefined as number | undefined };
  const inboundAudio = { bytesReceived: 0, packetsReceived: 0, packetsLost: 0, jitter: undefined as number | undefined, audioLevel: undefined as number | undefined, totalAudioEnergy: undefined as number | undefined };
  let selectedCandidatePair: CallDiagnostics["selectedCandidatePair"];

  stats.forEach((raw) => {
    const r = raw as RTCStats & Record<string, unknown>;
    const kind = r.kind || r.mediaType;
    if (r.type === "outbound-rtp" && kind === "audio") {
      outboundAudio.bytesSent += Number(r.bytesSent || 0);
      outboundAudio.packetsSent += Number(r.packetsSent || 0);
    }
    if (r.type === "inbound-rtp" && kind === "audio") {
      inboundAudio.bytesReceived += Number(r.bytesReceived || 0);
      inboundAudio.packetsReceived += Number(r.packetsReceived || 0);
      inboundAudio.packetsLost += Number(r.packetsLost || 0);
      if (typeof r.jitter === "number") inboundAudio.jitter = r.jitter;
    }
    if ((r.type === "media-source" || String(r.type) === "track") && kind === "audio") {
      if (typeof r.audioLevel === "number") outboundAudio.audioLevel = r.audioLevel;
      if (typeof r.totalAudioEnergy === "number") outboundAudio.totalAudioEnergy = r.totalAudioEnergy;
    }
    if (r.type === "remote-inbound-rtp" && kind === "audio" && typeof r.roundTripTime === "number") {
      selectedCandidatePair = { ...(selectedCandidatePair || {}), currentRoundTripTime: r.roundTripTime };
    }
    if (r.type === "candidate-pair" && (r.selected || r.nominated || r.state === "succeeded")) {
      const local = stats.get(String(r.localCandidateId)) as (RTCStats & Record<string, unknown>) | undefined;
      const remote = stats.get(String(r.remoteCandidateId)) as (RTCStats & Record<string, unknown>) | undefined;
      selectedCandidatePair = {
        ...(selectedCandidatePair || {}),
        state: String(r.state || ""),
        nominated: Boolean(r.nominated || r.selected),
        currentRoundTripTime: typeof r.currentRoundTripTime === "number" ? r.currentRoundTripTime : selectedCandidatePair?.currentRoundTripTime,
        localCandidateType: local?.candidateType ? String(local.candidateType) : undefined,
        remoteCandidateType: remote?.candidateType ? String(remote.candidateType) : undefined,
        localProtocol: local?.protocol ? String(local.protocol) : undefined,
        remoteProtocol: remote?.protocol ? String(remote.protocol) : undefined,
      };
    }
  });

  return {
    connectionState: session.pc.connectionState,
    iceConnectionState: session.pc.iceConnectionState,
    iceGatheringState: session.pc.iceGatheringState,
    signalingState: session.pc.signalingState,
    localAudioTracks: session.localStream.getAudioTracks().map((t) => ({ id: t.id, enabled: t.enabled, readyState: t.readyState, muted: t.muted })),
    remoteAudioTracks: session.remoteStream.getAudioTracks().map((t) => ({ id: t.id, enabled: t.enabled, readyState: t.readyState, muted: t.muted })),
    outboundAudio,
    inboundAudio,
    selectedCandidatePair,
  };
}

function attachIceCollectors(pc: RTCPeerConnection, callId: string, side: "caller" | "callee", callNonce: string) {
  const col = collection(db, "calls", callId, side === "caller" ? "offerCandidates" : "answerCandidates");
  pc.onicecandidate = (e) => {
    if (e.candidate) addDoc(col, { ...e.candidate.toJSON(), callNonce, createdAt: serverTimestamp() }).catch(() => {});
  };
}

function watchRemoteCandidates(pc: RTCPeerConnection, callId: string, side: "caller" | "callee", callNonce: string) {
  const remoteCol = collection(
    db,
    "calls",
    callId,
    side === "caller" ? "answerCandidates" : "offerCandidates",
  );
  const pending: RTCIceCandidateInit[] = [];
  const addOrQueue = (candidate: RTCIceCandidateInit) => {
    if (!pc.remoteDescription) {
      pending.push(candidate);
      return;
    }
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => pending.push(candidate));
  };
  const flush = () => {
    if (!pc.remoteDescription || !pending.length) return;
    const queued = pending.splice(0);
    queued.forEach((candidate) => {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => pending.push(candidate));
    });
  };
  const unsubscribe = onSnapshot(remoteCol, (snap) => {
    snap.docChanges().forEach((ch) => {
      if (ch.type === "added") {
        const candidate = ch.doc.data() as CandidateDoc;
        if (candidate.callNonce !== callNonce) return;
        addOrQueue(candidate);
      }
    });
    flush();
  });
  return { unsubscribe, flush };
}

const outgoingLocks = new Map<string, Promise<RtcSession>>();

export async function startOutgoingCall(params: {
  caller: string;
  callee: string;
  callerProfile: { displayName: string; photoURL: string; username: string };
}): Promise<RtcSession> {
  const pairId = chatIdFor(params.caller, params.callee);
  const locked = outgoingLocks.get(pairId);
  if (locked) return locked;
  const pending = startOutgoingCallInternal(params).finally(() => {
    setTimeout(() => {
      if (outgoingLocks.get(pairId) === pending) outgoingLocks.delete(pairId);
    }, 1_000);
  });
  outgoingLocks.set(pairId, pending);
  return pending;
}

async function startOutgoingCallInternal(params: {
  caller: string;
  callee: string;
  callerProfile: { displayName: string; photoURL: string; username: string };
}): Promise<RtcSession> {
  const callId = callIdFor(params.caller, params.callee);
  const callNonce = makeCallNonce();
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
    callNonce,
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
      assertAudioSdp(o, "ICE restart offer");
      await pc.setLocalDescription(o);
      await updateDoc(callRef, { offer: { type: o.type, sdp: o.sdp }, callNonce });
    },
    getDiagnostics: () => getDiagnosticsFor(session),
  };

  pc.ontrack = (e) => {
    e.streams[0].getTracks().forEach((t) => {
      t.enabled = true;
      if (!remoteStream.getTracks().find((x) => x.id === t.id)) remoteStream.addTrack(t);
    });
    remoteCbs.forEach((cb) => cb(remoteStream));
  };

  attachIceCollectors(pc, callId, "caller", callNonce);

  const offer = await pc.createOffer();
  assertAudioSdp(offer, "Offer");
  await pc.setLocalDescription(offer);
  await setDoc(callRef, {
    caller: params.caller,
    callee: params.callee,
    status: "ringing",
    offer: { type: offer.type, sdp: offer.sdp },
    callerProfile: params.callerProfile,
    callNonce,
    createdAt: serverTimestamp(),
  } satisfies CallDoc);

  const unsubCall = onSnapshot(callRef, async (s) => {
    const data = s.data() as CallDoc | undefined;
    if (!data || data.callNonce !== callNonce) return;
    if (data.status !== session.currentStatus) {
      session.currentStatus = data.status;
      statusCbs.forEach((cb) => cb(data.status));
    }
    if (data.answer && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer)).catch(() => {});
      remoteIce.flush();
    }
  });
  const remoteIce = watchRemoteCandidates(pc, callId, "caller", callNonce);

  let restartedOnce = false;
  pc.oniceconnectionstatechange = async () => {
    if (pc.iceConnectionState === "disconnected" && !restartedOnce) {
      restartedOnce = true;
      try {
        const restart = await pc.createOffer({ iceRestart: true });
        assertAudioSdp(restart, "ICE restart offer");
        await pc.setLocalDescription(restart);
        await updateDoc(callRef, { offer: { type: restart.type, sdp: restart.sdp }, callNonce });
      } catch { /* ignore */ }
    }
    if (pc.iceConnectionState === "failed") {
      session.currentStatus = "ended";
      statusCbs.forEach((cb) => cb("ended"));
    }
  };

  session.hangup = async () => {
    updateDoc(callRef, { status: "ended" }).catch(() => {});
    try { pc.getSenders().forEach((s) => s.track && s.track.stop()); } catch { /* ignore */ }
    try { pc.close(); } catch { /* ignore */ }
    localStream.getTracks().forEach((t) => t.stop());
    unsubCall();
    remoteIce.unsubscribe();
    setTimeout(() => { deleteDoc(callRef).catch(() => {}); }, 15_000);
  };

  return session;
}

export async function acceptIncomingCall(callId: string): Promise<RtcSession> {
  const callRef = doc(db, "calls", callId);
  // Start microphone capture before any awaited Firestore read so mobile browsers keep the user-gesture media permission path intact.
  const localStreamPromise = getMic();
  const snap = await getDoc(callRef);
  const data = snap.data() as CallDoc | undefined;
  if (!data?.offer) throw new Error("Call is no longer available.");
  const callNonce = data.callNonce || makeCallNonce();

  const iceServers = buildIceServers();
  const pc = new RTCPeerConnection({ iceServers });
  const localStream = await localStreamPromise;
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  const remoteStream = new MediaStream();

  const remoteCbs = new Set<(s: MediaStream) => void>();
  const statusCbs = new Set<(s: CallStatus) => void>();
  const session: RtcSession = {
    callId,
    callNonce,
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
    getDiagnostics: () => getDiagnosticsFor(session),
  };

  pc.ontrack = (e) => {
    e.streams[0].getTracks().forEach((t) => {
      t.enabled = true;
      if (!remoteStream.getTracks().find((x) => x.id === t.id)) remoteStream.addTrack(t);
    });
    remoteCbs.forEach((cb) => cb(remoteStream));
  };
  attachIceCollectors(pc, callId, "callee", callNonce);
  const remoteIce = watchRemoteCandidates(pc, callId, "callee", callNonce);

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  remoteIce.flush();
  const answer = await pc.createAnswer();
  assertAudioSdp(answer, "Answer");
  await pc.setLocalDescription(answer);
  await updateDoc(callRef, {
    status: "accepted",
    answer: { type: answer.type, sdp: answer.sdp },
    callNonce,
  });

  const unsubCall = onSnapshot(callRef, (s) => {
    const d = s.data() as CallDoc | undefined;
    if (d && d.callNonce === callNonce && d.status !== session.currentStatus) {
      session.currentStatus = d.status;
      statusCbs.forEach((cb) => cb(d.status));
    }
  });

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "failed") {
      session.currentStatus = "ended";
      statusCbs.forEach((cb) => cb("ended"));
    }
  };

  session.hangup = async () => {
    updateDoc(callRef, { status: "ended" }).catch(() => {});
    try { pc.getSenders().forEach((s) => s.track && s.track.stop()); } catch { /* ignore */ }
    try { pc.close(); } catch { /* ignore */ }
    localStream.getTracks().forEach((t) => t.stop());
    unsubCall();
    remoteIce.unsubscribe();
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
