import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    // Home always redirects into the app; auth layout takes over.
    throw redirect({ to: "/chats" });
  },
});
