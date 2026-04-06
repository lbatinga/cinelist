importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBj3dOMt3v6zw3SHAGdnBEWB_BuDYVBBD0",
  authDomain: "cinelist-new.firebaseapp.com",
  projectId: "cinelist-new",
  storageBucket: "cinelist-new.firebasestorage.app",
  messagingSenderId: "101304466431",
  appId: "1:101304466431:web:22b0367c1845ee8404c5ca"
});

const messaging = firebase.messaging();

// Notificação em background (app fechado)
messaging.onBackgroundMessage(payload => {
  console.log('Background message:', payload);
  const { title = 'CineList', body = '' } = payload.notification || {};
  const data = payload.data || {};

  self.registration.showNotification(title, {
    body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: data.url || 'https://lbatinga.github.io/cinelist/' },
    vibrate: [200, 100, 200]
  });
});

// Ao clicar na notificação, abre o app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || 'https://lbatinga.github.io/cinelist/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('lbatinga.github.io/cinelist') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// Cache básico
const CACHE = 'cinelist-v2';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.url.includes('supabase.co') || e.request.url.includes('gstatic.com')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
