// Service worker: permite instalar o app no celular e abrir a "casca" offline.
// Estratégia "rede primeiro": sempre busca a versão nova; usa o cache só sem internet.
const CACHE = 'sindico-total-v3';
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
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('sindico-total-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const recursos = new Set(CASCA.map((arquivo) => new URL(arquivo, self.registration.scope).href));

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || !recursos.has(request.url)) return;

  // Cache apenas a casca estática. Retornos de autenticação com parâmetros
  // e chamadas ao Supabase seguem diretamente para a rede.
  e.respondWith(fetch(request).catch(async () => {
    const cache = await caches.open(CACHE);
    const resposta = await cache.match(request);
    if (resposta) return resposta;
    return Response.error();
  }));
});
