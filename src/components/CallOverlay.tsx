import { useEffect, useRef, useState } from "react";
import { useCallStore } from "../lib/call-store";
import { acceptIncomingCall, declineCall, mixAudio } from "../lib/webrtc";
import { useSettingsStore } from "../lib/settings-store";
import { Phone, PhoneOff, Mic, MicOff, Volume2, Volume1 } from "lucide-react";

// Simple ringtone via WebAudio (no external asset)
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
  const recRef = useRef<{ rec: MediaRecorder; chunks: Blob[]; ctx: AudioContext } | null>(null);
  const callRecording = useSettingsStore((s) => s.settings.callRecording);

  useRingtone(ui === "incoming" || (ui === "outgoing" && status === "ringing"));

  // Wire remote stream to <audio>
  useEffect(() => {
    if (!session || !audioRef.current) return;
    session.onRemoteTrack((stream) => {
      if (audioRef.current) {
        audioRef.current.srcObject = stream;
        audioRef.current.play().catch(() => {});
      }
    });
    session.onStatus((s) => {
      set({ status: s });
      if (s === "accepted" && ui !== "in-call") {
        set({ ui: "in-call", startedAt: Date.now() });
        // Start local recording if enabled
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Duration timer
  useEffect(() => {
    if (ui !== "in-call" || !startedAt) return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(iv);
  }, [ui, startedAt]);

  // Speaker toggle (best-effort via setSinkId)
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
    finalizeRecording();
    if (session) await session.hangup().catch(() => {});
    reset();
    setMuted(false);
    setElapsed(0);
  };

  const accept = async () => {
    if (!incomingCallId) return;
    setError(null);
    try {
      const s = await acceptIncomingCall(incomingCallId);
      set({ session: s, ui: "in-call", status: "accepted", startedAt: Date.now(), incomingCallId: null });
      // recording will start via onStatus effect above
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to accept");
      reset();
    }
  };

  const decline = async () => {
    if (incomingCallId) await declineCall(incomingCallId);
    reset();
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

  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex flex-col items-center justify-between p-8 animate-fade-up">
      <audio ref={audioRef} autoPlay playsInline />
      <div className="mt-16 text-center">
        <div className="text-sm uppercase tracking-widest opacity-70">{label}</div>
      </div>
      <div className="flex flex-col items-center gap-4">
        {peer?.photoURL ? (
          <img src={peer.photoURL} alt="" className="w-40 h-40 rounded-full object-cover shadow-2xl ring-4 ring-white/10" />
        ) : (
          <div className="w-40 h-40 rounded-full gradient-brand grid place-items-center text-6xl font-bold shadow-2xl">
            {peer?.displayName?.[0]?.toUpperCase() || "?"}
          </div>
        )}
        <div className="text-2xl font-bold">{peer?.displayName || "Unknown"}</div>
        {peer?.username && <div className="text-sm opacity-70">@{peer.username}</div>}
        {error && <div className="text-sm text-red-300 mt-2">{error}</div>}
      </div>

      <div className="w-full max-w-sm">
        {ui === "incoming" ? (
          <div className="flex items-center justify-around">
            <button
              onClick={decline}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 grid place-items-center shadow-xl"
              aria-label="Decline"
            >
              <PhoneOff />
            </button>
            <button
              onClick={accept}
              className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 grid place-items-center shadow-xl"
              aria-label="Accept"
            >
              <Phone />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-around">
            <button
              onClick={toggleMute}
              className={`w-14 h-14 rounded-full grid place-items-center shadow-xl ${muted ? "bg-white text-slate-900" : "bg-white/10 hover:bg-white/20"}`}
              aria-label="Mute"
            >
              {muted ? <MicOff /> : <Mic />}
            </button>
            <button
              onClick={endCall}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 grid place-items-center shadow-xl"
              aria-label="End call"
            >
              <PhoneOff />
            </button>
            <button
              onClick={() => setSpeaker((s) => !s)}
              className={`w-14 h-14 rounded-full grid place-items-center shadow-xl ${speaker ? "bg-white/10 hover:bg-white/20" : "bg-white text-slate-900"}`}
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
