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
  const data = payload.data || {};
  const title = data.title || 'CineList';
  const body = data.body || '';
  self.registration.showNotification(title, {
    body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: data.url || 'https://lbatinga.github.io/cinelist/' },
    vibrate: [200, 100, 200]
  });
});

// Só segue URL que seja do próprio app: mesma origem E dentro do escopo do SW (/cinelist/).
// O endpoint de push não tem segredo, então data.url pode ser forjado — se não bater, abre a
// home em vez de levar quem tocou pra fora. Parseia com URL (não startsWith em string), o que
// barra .evil.com, @evil.com, // e .. de uma vez; só o origin deixaria passar outros repos
// do mesmo github.io, por isso o pathname também é conferido.
function urlDoApp(raw) {
  const scope = new URL(self.registration.scope);
  try {
    if (typeof raw === 'string') {
      const u = new URL(raw, scope);
      if (u.origin === scope.origin && u.pathname.startsWith(scope.pathname)) return u.href;
    }
  } catch (e) {}
  return scope.href;
}

// Ao clicar na notificação, abre o app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = urlDoApp(e.notification.data?.url);
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

// SEM CACHE — sempre busca a versão mais recente da rede
const CACHE = 'cinelist-v3';

self.addEventListener('install', e => {
  self.skipWaiting(); // Ativa imediatamente sem esperar fechar o app
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k))) // Limpa TODO o cache antigo
    ).then(() => self.clients.claim()) // Toma controle imediatamente
  );
});

self.addEventListener('fetch', e => {
  // Nunca serve cache — sempre vai para a rede
  // Só ignora requisições externas (Supabase, Firebase)
  if (
    e.request.url.includes('supabase.co') ||
    e.request.url.includes('gstatic.com') ||
    e.request.url.includes('firebase') ||
    e.request.url.includes('tmdb.org')
  ) return;

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
