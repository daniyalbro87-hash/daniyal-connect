import { useRef, useState } from "react";
import { uploadToCloudinary } from "../lib/cloudinary";
import { sendMessage, setTyping, type MessageDoc } from "../lib/chat";
import { VoiceRecorder } from "./VoiceRecorder";

export function Composer({
  chatId,
  senderId,
  receiverId,
}: {
  chatId: string;
  senderId: string;
  receiverId: string;
}) {
  const [text, setText] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState<{ pct: number; label: string } | null>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const vidInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const camInput = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = async (partial: Partial<MessageDoc>) => {
    await sendMessage(chatId, {
      type: "text",
      sender: senderId,
      receiver: receiverId,
      ...partial,
    } as MessageDoc);
  };

  const sendText = async () => {
    const v = text.trim(); if (!v) return;
    setText("");
    setTyping(chatId, senderId, false);
    await send({ type: "text", text: v });
  };

  const onChangeText = (v: string) => {
    setText(v);
    setTyping(chatId, senderId, true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(chatId, senderId, false), 2000);
  };

  const handleImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAttachOpen(false);
    const arr = Array.from(files);
    const uploaded: MessageDoc["media"] = [];
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      setUploading({ pct: 0, label: `Uploading photo ${i + 1}/${arr.length}` });
      try {
        const res = await uploadToCloudinary(f, (pct) => setUploading({ pct, label: `Uploading photo ${i + 1}/${arr.length}` }));
        uploaded!.push({
          secure_url: res.secure_url, public_id: res.public_id, mime: f.type, size: res.bytes,
          width: res.width, height: res.height, filename: res.original_filename,
        });
      } catch (e) { console.error(e); }
    }
    setUploading(null);
    if (uploaded!.length) {
      await send({ type: uploaded!.length > 1 ? "images" : "image", media: uploaded });
    }
  };

  const handleVideo = async (files: FileList | null) => {
    const f = files?.[0]; if (!f) return;
    setAttachOpen(false);
    setUploading({ pct: 0, label: "Uploading video" });
    try {
      const res = await uploadToCloudinary(f, (pct) => setUploading({ pct, label: "Uploading video" }));
      await send({
        type: "video",
        media: [{
          secure_url: res.secure_url, public_id: res.public_id, mime: f.type, size: res.bytes,
          duration: res.duration, width: res.width, height: res.height, filename: res.original_filename,
        }],
      });
    } finally { setUploading(null); }
  };

  const handleFile = async (files: FileList | null) => {
    const f = files?.[0]; if (!f) return;
    setAttachOpen(false);
    setUploading({ pct: 0, label: `Uploading ${f.name}` });
    try {
      const res = await uploadToCloudinary(f, (pct) => setUploading({ pct, label: `Uploading ${f.name}` }));
      await send({
        type: "file",
        media: [{
          secure_url: res.secure_url, public_id: res.public_id, mime: f.type, size: res.bytes,
          filename: f.name,
        }],
      });
    } finally { setUploading(null); }
  };

  const handleVoice = async (blob: Blob, duration: number) => {
    setRecording(false);
    const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
    setUploading({ pct: 0, label: "Sending voice note" });
    try {
      const res = await uploadToCloudinary(file, (pct) => setUploading({ pct, label: "Sending voice note" }));
      await send({
        type: "audio",
        media: [{
          secure_url: res.secure_url, public_id: res.public_id, mime: file.type, size: res.bytes,
          duration: res.duration || duration,
        }],
      });
    } finally { setUploading(null); }
  };

  return (
    <div className="glass sticky bottom-0 p-3 border-t border-border/60">
      {uploading && (
        <div className="mb-2 flex items-center gap-3 px-3 py-2 rounded-xl bg-surface animate-fade-up">
          <div className="text-xs font-medium">{uploading.label}</div>
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full gradient-brand transition-all" style={{ width: `${uploading.pct}%` }} />
          </div>
          <div className="text-xs tabular-nums text-muted-foreground">{uploading.pct}%</div>
        </div>
      )}

      {recording ? (
        <VoiceRecorder onSend={handleVoice} onCancel={() => setRecording(false)} />
      ) : (
        <div className="flex items-end gap-2 relative">
          <div className="relative">
            <button
              onClick={() => setAttachOpen((v) => !v)}
              className="shrink-0 p-3 rounded-full bg-surface hover:shadow-soft transition"
              aria-label="Attach"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14"/></svg>
            </button>
            {attachOpen && (
              <div className="absolute bottom-14 left-0 glass rounded-2xl p-2 shadow-soft grid grid-cols-2 gap-1 w-56 animate-pop z-20">
                <AttachBtn label="Camera" color="#ef4444" onClick={() => camInput.current?.click()}
                  icon={<path d="M4 7h3l2-2h6l2 2h3v12H4V7zM12 17a4 4 0 100-8 4 4 0 000 8z"/>} />
                <AttachBtn label="Gallery" color="#8b5cf6" onClick={() => imgInput.current?.click()}
                  icon={<><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></>} />
                <AttachBtn label="Video" color="#3b82f6" onClick={() => vidInput.current?.click()}
                  icon={<><rect x="3" y="6" width="14" height="12" rx="2"/><path d="M17 10l4-2v8l-4-2z"/></>} />
                <AttachBtn label="Document" color="#10b981" onClick={() => fileInput.current?.click()}
                  icon={<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6zM14 3v6h6"/>} />
              </div>
            )}
            <input ref={imgInput} type="file" accept="image/*" multiple hidden onChange={(e) => handleImages(e.target.files)} />
            <input ref={camInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => handleImages(e.target.files)} />
            <input ref={vidInput} type="file" accept="video/*" hidden onChange={(e) => handleVideo(e.target.files)} />
            <input ref={fileInput} type="file" hidden onChange={(e) => handleFile(e.target.files)} />
          </div>

          <textarea
            value={text}
            onChange={(e) => onChangeText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); } }}
            placeholder="Type a message…"
            rows={1}
            className="flex-1 resize-none max-h-32 bg-surface rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary/40 text-[15px]"
          />

          {text.trim() ? (
            <button onClick={sendText} className="shrink-0 rounded-full gradient-brand text-white p-3 shadow-glow" aria-label="Send">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M2.4 20.4l19.2-8.4c.8-.4.8-1.6 0-2L2.4 1.6c-.7-.3-1.5.3-1.3 1.1L3.5 10 15 12 3.5 14l-2.4 7.3c-.2.8.6 1.4 1.3 1.1z"/></svg>
            </button>
          ) : (
            <button onClick={() => setRecording(true)} className="shrink-0 rounded-full gradient-brand text-white p-3 shadow-glow" aria-label="Record voice note">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z"/></svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AttachBtn({ label, color, icon, onClick }: { label: string; color: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-muted transition">
      <span className="w-10 h-10 rounded-full grid place-items-center text-white" style={{ background: color }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">{icon}</svg>
      </span>
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}
