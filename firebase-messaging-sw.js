// 通知を受け取るための裏方のファイル（リポジトリの一番上に置く）

// 届いた通知は、アプリを開いているときも閉じているときも、必ずここで1回だけ表示する
// （iPhoneは、表示しない通知が続くと通知を止めてしまうため）
self.addEventListener("push", event => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch (e) { p = {}; }
  const d = p.data || p.notification || {};
  event.waitUntil(
    self.registration.showNotification(d.title || "Home To Do", {
      body: d.body || "",
      data: { url: d.url || "./" }
    })
  );
});

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

// 通知の登録（トークン）のために読み込む。表示は上の push で行うので、ここでは表示しない
firebase.messaging();

// 通知をタップしたら、アプリを開く（開いていれば、その画面に切り替える）
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if ("focus" in c) return c.focus();
    }
    return clients.openWindow(url);
  })());
});
