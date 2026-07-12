import { useEffect, useState } from "react";
import { cldImage } from "../lib/cloudinary";

export function ImageViewer({
  urls,
  index,
  onClose,
}: {
  urls: string[];
  index: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(index);
  useEffect(() => setI(index), [index]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((v) => Math.min(urls.length - 1, v + 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [urls.length, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/95 grid place-items-center animate-pop">
      <button onClick={onClose} className="absolute top-4 right-4 text-white/80 hover:text-white p-2" aria-label="Close">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <a
        href={urls[i]}
        download
        target="_blank"
        rel="noreferrer"
        className="absolute top-4 left-4 text-white/80 hover:text-white p-2"
        aria-label="Download"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>
      </a>
      <img
        src={cldImage(urls[i], { w: 1600 })}
        alt=""
        className="max-w-[95vw] max-h-[90vh] object-contain select-none"
        style={{ touchAction: "pinch-zoom" }}
      />
      {urls.length > 1 && (
        <>
          <button
            onClick={() => setI((v) => Math.max(0, v - 1))}
            disabled={i === 0}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white p-3 disabled:opacity-30"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <button
            onClick={() => setI((v) => Math.min(urls.length - 1, v + 1))}
            disabled={i === urls.length - 1}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white p-3 disabled:opacity-30"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 6l6 6-6 6"/></svg>
          </button>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/80 text-sm">
            {i + 1} / {urls.length}
          </div>
        </>
      )}
    </div>
  );
}
