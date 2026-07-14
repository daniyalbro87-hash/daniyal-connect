/* Firebase Cloud Messaging background service worker */
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBi9Fky384axSi5s38Y7w0YpIfd5BtdG5E",
  authDomain: "daniyal-chat-de390.firebaseapp.com",
  projectId: "daniyal-chat-de390",
  messagingSenderId: "639500090169",
  appId: "1:639500090169:web:a5e43044fce21830c006e8",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || "Daniyal Chat";
  const options = {
    body: (payload.notification && payload.notification.body) || "",
    icon: "/icon-512.png",
    badge: "/icon-512.png",
    tag: (payload.data && payload.data.tag) || "message",
    data: payload.data || {},
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = data.chatId
    ? `/chat/${data.chatId}`
    : data.type === "friend_request"
      ? "/friends"
      : "/chats";
  event.waitUntil(
    (async () => {
      const clientsArr = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientsArr) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) client.navigate(target);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })(),
  );
});
