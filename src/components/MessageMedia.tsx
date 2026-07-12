import { useEffect, useRef, useState } from "react";
import { cldImage } from "../lib/cloudinary";
import type { MessageDoc } from "../lib/chat";

type Media = NonNullable<MessageDoc["media"]>[number];

export function MessageMedia({ msg, onOpenImage }: { msg: MessageDoc; onOpenImage: (urls: string[], idx: number) => void }) {
  if (msg.type === "text") return null;
  if ((msg.type === "image" || msg.type === "images") && msg.media?.length) {
    return <ImageGrid media={msg.media} onOpen={(i) => onOpenImage(msg.media!.map((m) => m.secure_url), i)} />;
  }
  if (msg.type === "video" && msg.media?.[0]) return <VideoPlayer m={msg.media[0]} />;
  if (msg.type === "audio" && msg.media?.[0]) return <AudioPlayer m={msg.media[0]} />;
  if (msg.type === "file" && msg.media?.[0]) return <FileCard m={msg.media[0]} />;
  return null;
}

function ImageGrid({ media, onOpen }: { media: Media[]; onOpen: (i: number) => void }) {
  const n = media.length;
  const cols = n === 1 ? "grid-cols-1" : n === 2 ? "grid-cols-2" : n === 3 ? "grid-cols-2" : "grid-cols-2";
  return (
    <div className={`grid gap-1 ${cols}`} style={{ maxWidth: n === 1 ? 320 : 280 }}>
      {media.slice(0, 4).map((m, i) => (
        <button
          key={m.public_id}
          onClick={() => onOpen(i)}
          className={`relative overflow-hidden rounded-xl ${n === 3 && i === 0 ? "row-span-2" : ""}`}
          style={{ aspectRatio: n === 1 ? "auto" : "1 / 1" }}
        >
          <img
            src={cldImage(m.secure_url, { w: 600 })}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover hover:scale-105 transition duration-500"
            style={n === 1 ? { maxHeight: 360, width: "auto" } : {}}
          />
          {i === 3 && media.length > 4 && (
            <div className="absolute inset-0 bg-black/50 text-white grid place-items-center text-2xl font-bold">
              +{media.length - 4}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

function VideoPlayer({ m }: { m: Media }) {
  return (
    <video
      src={m.secure_url}
      controls
      preload="metadata"
      className="rounded-xl max-w-[320px] max-h-[400px] bg-black"
    />
  );
}

function AudioPlayer({ m }: { m: Media }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(m.duration || 0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const onT = () => setCur(el.currentTime);
    const onD = () => setDur(el.duration || 0);
    const onE = () => setPlaying(false);
    el.addEventListener("timeupdate", onT);
    el.addEventListener("loadedmetadata", onD);
    el.addEventListener("ended", onE);
    return () => { el.removeEventListener("timeupdate", onT); el.removeEventListener("loadedmetadata", onD); el.removeEventListener("ended", onE); };
  }, []);
  const toggle = () => {
    const el = ref.current; if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { el.play(); setPlaying(true); }
  };
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return (
    <div className="flex items-center gap-3 min-w-[220px]">
      <audio ref={ref} src={m.secure_url} preload="metadata" />
      <button onClick={toggle} className="w-10 h-10 rounded-full bg-white/20 grid place-items-center backdrop-blur">
        {playing ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8V4z"/></svg>
        )}
      </button>
      <input
        type="range" min={0} max={dur || 0} step={0.1} value={cur}
        onChange={(e) => { const el = ref.current; if (el) { el.currentTime = Number(e.target.value); setCur(Number(e.target.value)); } }}
        className="flex-1 accent-white"
      />
      <div className="text-xs tabular-nums opacity-80">{fmt(dur - cur)}</div>
    </div>
  );
}

function FileCard({ m }: { m: Media }) {
  const kb = (m.size / 1024).toFixed(0);
  const size = m.size > 1024 * 1024 ? `${(m.size / 1024 / 1024).toFixed(1)} MB` : `${kb} KB`;
  const ext = (m.filename || m.public_id).split(".").pop()?.toUpperCase() || "FILE";
  return (
    <a href={m.secure_url} target="_blank" rel="noreferrer" download
       className="flex items-center gap-3 min-w-[240px] p-2 rounded-xl bg-black/10 hover:bg-black/20 transition">
      <div className="w-11 h-11 rounded-xl bg-white/20 grid place-items-center font-bold text-xs">
        {ext.slice(0, 4)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{m.filename || "Document"}</div>
        <div className="text-xs opacity-75">{size}</div>
      </div>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>
    </a>
  );
}
