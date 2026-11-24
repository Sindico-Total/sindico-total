// Service worker: permite instalar o app no celular e abrir a "casca" offline.
// Estratégia "rede primeiro": sempre busca a versão nova; usa o cache só sem internet.
const CACHE = 'sindico-total-v2';
const CASCA = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/app.js', 'js/install.js', 'js/config.js', 'js/supabase.js', 'js/ui.js', 'js/pix.js',
  'js/views/auth.js', 'js/views/comum.js', 'js/views/morador.js', 'js/views/gestao.js', 'js/views/admin.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Supabase/CDN: direto na rede
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
