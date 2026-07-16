import { useEffect, useRef, useState } from "react";
import { useCallStore } from "../lib/call-store";
import { acceptIncomingCall, declineCall, mixAudio, unlockAudioPlayback } from "../lib/webrtc";
import { useSettingsStore } from "../lib/settings-store";
import { Phone, PhoneOff, Mic, MicOff, Volume2, Volume1 } from "lucide-react";

function useRingtone(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    let stopped = false;
    const play = () => {
      if (stopped) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 480;
      g.gain.value = 0.0001;
      o.connect(g).connect(ctx.destination);
      const t = ctx.currentTime;
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.start(t);
      o.stop(t + 1);
    };
    play();
    const iv = setInterval(play, 1400);
    return () => {
      stopped = true;
      clearInterval(iv);
      ctx.close().catch(() => {});
    };
  }, [active]);
}

export function CallOverlay() {
  const { ui, peer, session, status, incomingCallId, startedAt, set, reset } = useCallStore();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playBlocked, setPlayBlocked] = useState(false);
  const recRef = useRef<{ rec: MediaRecorder; chunks: Blob[]; ctx: AudioContext } | null>(null);
  const callRecording = useSettingsStore((s) => s.settings.callRecording);
  const endedRef = useRef(false);
  const acceptLockRef = useRef(false);

  useRingtone(ui === "incoming" || (ui === "outgoing" && status === "ringing"));

  // Attach the session's remoteStream to the audio element as soon as we have one.
  // Because remoteStream is a stable MediaStream that ontrack mutates, this handles
  // the race where tracks arrive before an onRemoteTrack callback is registered.
  useEffect(() => {
    if (!session || !audioRef.current) return;
    const a = audioRef.current;
    a.srcObject = session.remoteStream;
    a.autoplay = true;
    a.muted = false;
    a.volume = 1;
    a.setAttribute("playsinline", "");
    const tryPlay = () => {
      a.muted = false;
      a.volume = 1;
      if (a.srcObject !== session.remoteStream) a.srcObject = session.remoteStream;
      return a.play().then(() => setPlayBlocked(false)).catch(() => setPlayBlocked(true));
    };
    tryPlay();

    // Also listen for future tracks (some browsers need play() re-invoked)
    session.onRemoteTrack(() => {
      a.srcObject = session.remoteStream;
      tryPlay();
    });

    const onTrackActive = () => { tryPlay(); };
    session.remoteStream.addEventListener("addtrack", onTrackActive);
    const statsTimer = window.setInterval(async () => {
      try {
        const d = await session.getDiagnostics();
        const connected = d.iceConnectionState === "connected" || d.iceConnectionState === "completed";
        const hasRemoteTrack = d.remoteAudioTracks.some((t) => t.readyState === "live" && t.enabled);
        if (connected && hasRemoteTrack && d.inboundAudio.packetsReceived > 0) tryPlay();
        if (connected && d.outboundAudio.packetsSent === 0) {
          console.warn("Call audio diagnostics: microphone track exists but no outbound RTP audio packets yet", d);
        }
        if (connected && d.remoteAudioTracks.length > 0 && d.inboundAudio.packetsReceived === 0) {
          console.warn("Call audio diagnostics: remote audio track exists but no inbound RTP audio packets yet", d);
        }
        if (connected && hasRemoteTrack && d.inboundAudio.packetsReceived > 0 && a.paused) {
          setPlayBlocked(true);
        }
      } catch { /* ignore diagnostics failures */ }
    }, 1500);

    session.onStatus((s) => {
      set({ status: s });
      if (s === "accepted" && useCallStore.getState().ui !== "in-call") {
        set({ ui: "in-call", startedAt: Date.now() });
        tryPlay();
        if (callRecording) {
          try {
            const { mixed, ctx } = mixAudio(session.localStream, session.remoteStream);
            const rec = new MediaRecorder(mixed, { mimeType: "audio/webm;codecs=opus" });
            const chunks: Blob[] = [];
            rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
            rec.start(1000);
            recRef.current = { rec, chunks, ctx };
          } catch (e) {
            console.warn("Recording unavailable", e);
          }
        }
      }
      if (s === "declined" || s === "ended") {
        endCall();
      }
    });
    return () => {
      window.clearInterval(statsTimer);
      session.remoteStream.removeEventListener("addtrack", onTrackActive);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (ui !== "in-call" || !startedAt) return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(iv);
  }, [ui, startedAt]);

  useEffect(() => {
    const a = audioRef.current as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (!a?.setSinkId) return;
    a.setSinkId(speaker ? "default" : "").catch(() => {});
  }, [speaker]);

  const finalizeRecording = () => {
    const r = recRef.current;
    if (!r) return;
    try {
      r.rec.stop();
      r.rec.onstop = () => {
        const blob = new Blob(r.chunks, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `daniyal-call-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        r.ctx.close().catch(() => {});
      };
    } catch { /* ignore */ }
    recRef.current = null;
  };

  const endCall = async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    // Reset UI INSTANTLY — teardown runs in the background.
    const s = session;
    reset();
    setBusy(false);
    acceptLockRef.current = false;
    setPlayBlocked(false);
    setMuted(false);
    setElapsed(0);
    finalizeRecording();
    if (s) s.hangup().catch(() => {});
    // Allow future calls
    setTimeout(() => { endedRef.current = false; }, 500);
  };

  const accept = async () => {
    if (!incomingCallId || busy || acceptLockRef.current) return;
    acceptLockRef.current = true;
    setBusy(true);
    setError(null);
    try {
      unlockAudioPlayback().catch(() => {});
      const s = await acceptIncomingCall(incomingCallId);
      set({ session: s, ui: "in-call", status: "accepted", startedAt: Date.now(), incomingCallId: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to accept");
      reset();
      acceptLockRef.current = false;
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (busy || acceptLockRef.current) return;
    acceptLockRef.current = true;
    const id = incomingCallId;
    reset(); // instant UI close
    setBusy(false);
    if (id) declineCall(id).catch(() => {});
    setTimeout(() => { acceptLockRef.current = false; }, 500);
  };

  const toggleMute = () => {
    if (!session) return;
    const next = !muted;
    setMuted(next);
    session.localStream.getAudioTracks().forEach((t) => (t.enabled = !next));
  };

  if (ui === "idle") return null;

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  const label =
    ui === "incoming"
      ? "Incoming call"
      : ui === "outgoing"
        ? "Calling…"
        : status === "accepted" || ui === "in-call"
          ? `${mm}:${ss}`
          : "Connecting…";

  const isIncoming = ui === "incoming";

  return (
    <div className="fixed inset-0 z-[100] text-white flex flex-col items-center justify-between p-6 animate-fade-up overflow-hidden">
      {/* Background: blurred avatar + gradient */}
      <div className="absolute inset-0 -z-10">
        {peer?.photoURL ? (
          <img src={peer.photoURL} alt="" className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-60" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950/80 via-indigo-950/80 to-slate-900/90" />
      </div>

      <audio ref={audioRef} autoPlay playsInline />

      <div className="mt-10 text-center animate-fade-up">
        <div className="text-[11px] uppercase tracking-[0.3em] opacity-80 font-medium">
          {isIncoming ? "Daniyal Chat • Incoming voice call" : label}
        </div>
      </div>

      <div className="flex flex-col items-center gap-5 animate-fade-up">
        <div className="relative">
          {isIncoming && (
            <>
              <span className="absolute inset-0 rounded-full ring-2 ring-white/30 animate-ping" />
              <span className="absolute -inset-4 rounded-full ring-2 ring-white/10 animate-ping [animation-delay:200ms]" />
              <span className="absolute -inset-8 rounded-full ring-2 ring-white/5 animate-ping [animation-delay:400ms]" />
            </>
          )}
          <div className="absolute -inset-2 rounded-full bg-white/10 blur-2xl" />
          {peer?.photoURL ? (
            <img src={peer.photoURL} alt="" className="relative w-44 h-44 rounded-full object-cover shadow-2xl ring-4 ring-white/20" />
          ) : (
            <div className="relative w-44 h-44 rounded-full gradient-brand grid place-items-center text-7xl font-bold shadow-2xl ring-4 ring-white/20">
              {peer?.displayName?.[0]?.toUpperCase() || "?"}
            </div>
          )}
        </div>
        <div className="text-3xl font-bold tracking-tight text-center">{peer?.displayName || "Unknown"}</div>
        {peer?.username && <div className="text-sm opacity-70">@{peer.username}</div>}
        {!isIncoming && (
          <div className="text-sm opacity-80 tabular-nums">{label}</div>
        )}
        {error && <div className="text-sm text-red-300 mt-2 text-center max-w-xs">{error}</div>}
        {playBlocked && ui === "in-call" && (
          <button
            type="button"
            onClick={() => unlockAudioPlayback().then(() => audioRef.current?.play()).catch(() => {})}
            className="text-sm text-white bg-white/15 hover:bg-white/25 rounded-full px-4 py-2 mt-2 active:scale-95 transition"
          >
            Tap to resume audio
          </button>
        )}
      </div>

      <div className="w-full max-w-sm mb-6">
        {isIncoming ? (
          <div className="flex items-center justify-between px-4">
            <button
              onClick={decline}
              disabled={busy}
              className="flex flex-col items-center gap-2 group"
              aria-label="Decline call"
            >
              <span className="relative w-[68px] h-[68px] rounded-full bg-red-500 grid place-items-center shadow-[0_10px_40px_-8px_rgba(239,68,68,0.7)] group-active:scale-90 transition-transform">
                <span className="absolute inset-0 rounded-full bg-red-500/40 animate-ping" />
                <PhoneOff size={26} className="relative" />
              </span>
              <span className="text-xs font-medium opacity-80">Decline</span>
            </button>
            <button
              onClick={accept}
              disabled={busy}
              className="flex flex-col items-center gap-2 group disabled:opacity-60"
              aria-label="Accept call"
            >
              <span className="relative w-[68px] h-[68px] rounded-full bg-emerald-500 grid place-items-center shadow-[0_10px_40px_-8px_rgba(16,185,129,0.7)] group-active:scale-90 transition-transform">
                <span className="absolute inset-0 rounded-full bg-emerald-500/40 animate-ping" />
                <Phone size={26} className="relative" />
              </span>
              <span className="text-xs font-medium opacity-80">Accept</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-around">
            <button
              onClick={toggleMute}
              className={`w-14 h-14 rounded-full grid place-items-center shadow-xl active:scale-90 transition backdrop-blur-xl ${muted ? "bg-white text-slate-900" : "bg-white/10 hover:bg-white/20"}`}
              aria-label="Mute"
            >
              {muted ? <MicOff /> : <Mic />}
            </button>
            <button
              onClick={endCall}
              className="w-[68px] h-[68px] rounded-full bg-red-500 hover:bg-red-600 active:scale-90 grid place-items-center shadow-[0_10px_40px_-8px_rgba(239,68,68,0.7)] transition"
              aria-label="End call"
            >
              <PhoneOff size={26} />
            </button>
            <button
              onClick={() => setSpeaker((s) => !s)}
              className={`w-14 h-14 rounded-full grid place-items-center shadow-xl active:scale-90 transition backdrop-blur-xl ${speaker ? "bg-white/10 hover:bg-white/20" : "bg-white text-slate-900"}`}
              aria-label="Speaker"
            >
              {speaker ? <Volume2 /> : <Volume1 />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

