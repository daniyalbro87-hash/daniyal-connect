import { useEffect, useState } from "react";

/**
 * Shows an iOS-specific "Add to Home Screen" hint the first time Safari users
 * visit, if the app isn't already installed. Dismissable and remembered.
 */
export function IOSInstallGuide() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = window.navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    const dismissed = localStorage.getItem("dc-ios-install-dismissed") === "1";
    if (isIOS && isSafari && !isStandalone && !dismissed) {
      const t = setTimeout(() => setShow(true), 1200);
      return () => clearTimeout(t);
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    localStorage.setItem("dc-ios-install-dismissed", "1");
    setShow(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-24 z-50 px-4 pointer-events-none">
      <div className="mx-auto max-w-md glass rounded-3xl p-4 shadow-glow animate-fade-up pointer-events-auto">
        <div className="flex items-start gap-3">
          <img src="/icon-512.png" alt="" className="w-10 h-10 rounded-xl shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">Install Daniyal Chat</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Tap{" "}
              <span className="inline-block px-1.5 py-0.5 rounded bg-muted font-mono">
                <svg
                  className="inline w-3 h-3 -mt-0.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              </span>{" "}
              then <b>Add to Home Screen</b>.
            </div>
          </div>
          <button
            onClick={dismiss}
            className="text-xs text-muted-foreground shrink-0 p-1"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
