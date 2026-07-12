import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuthStore } from "../lib/auth-store";
import { InstallPrompt } from "../components/InstallPrompt";
import { NotificationsBridge } from "../components/NotificationsBridge";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading } = useAuthStore();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
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
    </>
  );
}
