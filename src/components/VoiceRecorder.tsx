import { useEffect, useRef, useState } from "react";

export function VoiceRecorder({
  onSend,
  onCancel,
}: {
  onSend: (blob: Blob, durationSec: number) => void;
  onCancel: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
        const rec = new MediaRecorder(stream, { mimeType: mime });
        rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        recRef.current = rec;
        chunksRef.current = [];
        rec.start();
        setRecording(true);
        startedAtRef.current = Date.now();
        timerRef.current = setInterval(() => setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Microphone permission denied");
      }
    })();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const cleanup = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  };

  const stopAndSend = () => {
    const rec = recRef.current; if (!rec) return;
    const dur = (Date.now() - startedAtRef.current) / 1000;
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType });
      cleanup();
      onSend(blob, dur);
    };
    rec.stop();
    setRecording(false);
  };

  const cancel = () => {
    recRef.current?.stop();
    cleanup();
    onCancel();
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-3 p-2 bg-surface rounded-2xl border border-border">
      {err ? (
        <>
          <div className="flex-1 text-sm text-destructive">{err}</div>
          <button onClick={onCancel} className="text-sm px-3 py-1 rounded-full bg-muted">Close</button>
        </>
      ) : (
        <>
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          <div className="text-sm tabular-nums font-medium">{fmt(seconds)}</div>
          <div className="flex-1 text-sm text-muted-foreground">Recording…</div>
          <button onClick={cancel} className="p-2 rounded-full bg-muted hover:bg-muted/70" aria-label="Cancel">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
          <button onClick={stopAndSend} disabled={!recording} className="p-2 rounded-full gradient-brand text-white shadow-glow" aria-label="Send">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.4 20.4l19.2-8.4c.8-.4.8-1.6 0-2L2.4 1.6c-.7-.3-1.5.3-1.3 1.1L3.5 10 15 12 3.5 14l-2.4 7.3c-.2.8.6 1.4 1.3 1.1z"/></svg>
          </button>
        </>
      )}
    </div>
  );
}
