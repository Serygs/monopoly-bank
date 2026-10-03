/* Static shell only: do not cache authenticated data, financial mutations, invitations, or WebSocket traffic. */
const SHELL_VERSION = 'monopoly-bank-shell-v1';
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/monopoly-bank-192.svg',
  '/icons/monopoly-bank-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_VERSION).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('monopoly-bank-shell-') && key !== SHELL_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/').then(
          (response) =>
            response ??
            new Response('<!doctype html><title>Offline</title>', {
              headers: { 'content-type': 'text/html' },
            }),
        ),
      ),
    );
    return;
  }
  if (
    !url.pathname.startsWith('/assets/') &&
    !url.pathname.startsWith('/icons/') &&
    url.pathname !== '/manifest.webmanifest'
  )
    return;
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok)
            void caches.open(SHELL_VERSION).then((cache) => cache.put(request, response.clone()));
          return response;
        }),
    ),
  );
});
