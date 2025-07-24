const cacheName = 'customscreensaver-cache';
const filestoCache = [
    './',
    './index.html',
    './manifest.json',
    './icon.png',
    './icon.svg',
    './assets/index.css',
    './assets/index.js',
    './assets/work-sans-latin-400-normal.woff2',
    './assets/work-sans-latin-700-normal.woff2',
];
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(cacheName)
            .then(cache => cache.addAll(filestoCache))
    );
});
self.addEventListener('activate', e => self.clients.claim());
self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.url.indexOf("updatecode") !== -1) event.respondWith(fetch(req)); else event.respondWith(networkFirst(req));
});


async function networkFirst(req) {
    try {
        const networkResponse = await fetch(req);
        const cache = await caches.open(cacheName);
        await cache.delete(req);
        await cache.put(req, networkResponse.clone());
        return networkResponse;
    } catch (error) {
        const cachedResponse = await caches.match(req);
        return cachedResponse;
    }
}