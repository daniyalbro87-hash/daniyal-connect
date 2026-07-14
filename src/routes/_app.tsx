import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuthStore } from "../lib/auth-store";
import { useSettingsStore } from "../lib/settings-store";
import { InstallPrompt } from "../components/InstallPrompt";
import { NotificationsBridge } from "../components/NotificationsBridge";
import { IOSInstallGuide } from "../components/IOSInstallGuide";
import { CallListener } from "../components/CallListener";
import { CallOverlay } from "../components/CallOverlay";
import { enablePushNotifications } from "../lib/messaging";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading } = useAuthStore();
  const bind = useSettingsStore((s) => s.bind);
  const unbind = useSettingsStore((s) => s.unbind);
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user) bind(user.uid);
    return () => unbind();
  }, [user?.uid, bind, unbind]);

  // Auto-request notifications + register FCM once per session
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => {
      enablePushNotifications(user.uid).catch(() => {});
    }, 3000);
    return () => clearTimeout(t);
  }, [user?.uid]);

  if (loading || !user) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <div className="glass rounded-3xl px-8 py-6 shadow-soft flex items-center gap-4">
          <img src="/icon-512.png" alt="" className="w-10 h-10 rounded-xl" />
          <div>
            <div className="font-semibold">Daniyal Chat</div>
            <div className="text-xs text-muted-foreground">Loading your conversations…</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <>
      <Outlet />
      <NotificationsBridge />
      <InstallPrompt />
      <IOSInstallGuide />
      <CallListener />
      <CallOverlay />
    </>
  );
}
