// 通知を受け取るための裏方のファイル（リポジトリの一番上に置く）
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAfqtmYf_-inDRo6yEfbfkJjTAlBtHPao8",
  authDomain: "house-todo-1ef41.firebaseapp.com",
  projectId: "house-todo-1ef41",
  storageBucket: "house-todo-1ef41.firebasestorage.app",
  messagingSenderId: "956040670932",
  appId: "1:956040670932:web:ee3b3d87e7f7e14b2ad541"
});

const messaging = firebase.messaging();

// データだけで届くので、ここで1回だけ通知を表示する
messaging.onBackgroundMessage(payload => {
  const d = payload.data || {};
  self.registration.showNotification(d.title || "やることリスト", {
    body: d.body || "",
    data: { url: d.url || "./" }
  });
});

// 通知をタップしたら、アプリを開く
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(clients.openWindow(url));
});
