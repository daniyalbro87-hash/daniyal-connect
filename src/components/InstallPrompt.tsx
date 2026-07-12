import { useEffect, useState } from "react";

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<Event | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setVisible(false));
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!visible || !deferred) return null;

  const install = async () => {
    // @ts-expect-error non-standard prompt
    deferred.prompt?.();
    setVisible(false);
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 glass rounded-2xl px-4 py-3 shadow-glow flex items-center gap-3 animate-pop">
      <img src="/icon-512.png" alt="" className="w-9 h-9 rounded-xl" />
      <div className="text-sm">
        <div className="font-semibold">Install Daniyal Chat</div>
        <div className="text-xs text-muted-foreground">Add to home screen for the full experience.</div>
      </div>
      <button onClick={install} className="ml-1 rounded-full gradient-brand text-white text-sm font-semibold px-3 py-1.5 shadow-soft">Install</button>
      <button onClick={() => setVisible(false)} className="text-muted-foreground p-1" aria-label="Dismiss">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
  );
}
