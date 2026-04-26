const CACHE_NAME = 'habit-tracker-v3';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/app.js',
    '/style.css',
    '/manifest.json'
];

// Install: cache core app shell
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
    );
    self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: cache-first for app shell, network-first for Firebase
self.addEventListener('fetch', event => {
    if (event.request.url.includes('firestore.googleapis.com') ||
        event.request.url.includes('firebase') ||
        event.request.url.includes('google')) {
        // Network-first for Firebase/Google APIs
        event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
        return;
    }
    // Cache-first for everything else
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
            if (response && response.status === 200 && response.type === 'basic') {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return response;
        }))
    );
});
