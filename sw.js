// Frosty: speichert die App auf dem Gerät, damit sie auch ohne Netz startet.
const CACHE = 'frostspur-app-v1';
const FONTS = 'frostspur-fonts-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== FONTS).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App-Dateien: sofort aus dem Speicher, im Hintergrund aktualisieren
  if (url.origin === self.location.origin) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
      if (hit) return hit;
      const r = await net;
      if (r) return r;
      if (req.mode === 'navigate') return (await c.match('./')) || (await c.match('./index.html'));
      return Response.error();
    }));
    return;
  }

  // Schriften: einmal laden, dann aus dem Speicher
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const r = await fetch(req); if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }
      catch (err) { return Response.error(); }
    }));
  }
  // GitHub-Anfragen laufen immer direkt übers Netz.
});
