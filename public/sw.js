const CACHE_NAME = 'svara-stars-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Никогда не трогаем API и сокет-соединения — там всегда должны быть
  // самые свежие данные (баланс кошелька, состояние игры за столом).
  // Кэширование этого привело бы к показу устаревших фишек/карт.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
    return;
  }
  if (event.request.method !== 'GET') return;

  // Для статики (сама страница, иконки, манифест) — сначала сеть (чтобы
  // после каждого обновления сайта грузилась свежая версия), а кэш —
  // только как запасной вариант, если нет соединения.
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
