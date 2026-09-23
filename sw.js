/* Bitácora de Raspaditas · service worker (v39.4)
 *
 * POR QUÉ EXISTE. Sin service worker, abrir la app sin señal dependía de que el navegador
 * todavía guardara la página (GitHub la marca con max-age=600: diez minutos). En el kiosco,
 * con la señal que va y viene, eso era una apuesta.
 *
 * QUÉ HACE:
 *   · La PÁGINA (index.html) va RED PRIMERO: si hay internet siempre se sirve la versión más
 *     nueva (y se guarda una copia); si no hay red o tarda más de 4 s, se sirve la copia.
 *     Así una versión nueva subida a GitHub llega en la siguiente apertura con red.
 *   · Las LIBRERÍAS de los CDN (versiones fijas, además verificadas con SRI) van CACHÉ
 *     PRIMERO: no cambian nunca, así que una vez bajadas no se vuelven a pedir.
 *   · NO toca Firebase, la API de Google ni el Worker del portal: los datos y las consultas
 *     de premios nunca se sirven desde una copia.
 *
 * SI ALGO SALE MAL: borrar este archivo del repositorio basta; la app sigue funcionando igual
 * que antes (la registra de forma tolerante a fallos).
 */
const CACHE = 'bitacora-v39.4';
const CDN = ['www.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fastly.jsdelivr.net',
             'fonts.googleapis.com', 'fonts.gstatic.com'];
const ESPERA_RED_MS = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.add(new Request('./', {cache: 'no-store'})))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('bitacora-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    e.respondWith(paginaRedPrimero(req, url));
    return;
  }
  if (CDN.includes(url.hostname)) {
    e.respondWith(libreriaCachePrimero(req));
  }
});

async function paginaRedPrimero(req, url) {
  const c = await caches.open(CACHE);
  // Solo para pruebas: ?sinred=1 simula que no hay conexión.
  const simularSinRed = url.searchParams.get('sinred') === '1';
  if (!simularSinRed) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), ESPERA_RED_MS);
      const r = await fetch(req, {signal: ctl.signal, cache: 'no-store'});
      clearTimeout(t);
      if (r && r.ok) c.put('./', r.clone());
      return r;
    } catch (_) { /* sin red o demasiado lenta: se sirve la copia */ }
  }
  const copia = (await c.match('./')) || (await c.match(req, {ignoreSearch: true}));
  if (copia) return copia;
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    '<div style="font:16px system-ui;padding:28px;max-width:520px;margin:40px auto">' +
    '<h2>Sin conexión</h2><p>La bitácora todavía no se guardó para usarse sin red en este aparato. ' +
    'Ábrela una vez con internet y a partir de ahí funcionará también sin señal.</p></div>',
    {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8'}}
  );
}

async function libreriaCachePrimero(req) {
  const c = await caches.open(CACHE);
  const guardada = await c.match(req);
  if (guardada) return guardada;
  const r = await fetch(req);
  if (r && r.ok) c.put(req, r.clone());
  return r;
}
