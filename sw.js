/* Bitácora de Raspaditas · service worker (v40.0)
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
 * v40.0:
 *   · Las librerías viven en una caché PROPIA (`bitacora-libs`) que ya no se borra al cambiar
 *     de versión: antes cada versión nueva tiraba lo descargado y, hasta volver a tener red,
 *     el lector QR podía quedarse sin su motor zxing.
 *   · Al instalarse, precarga lo que el kiosco necesita SIN señal: el motor zxing (su .js y
 *     su .wasm, que antes solo se descargaba la primera vez que se usaba la cámara con red),
 *     jsQR y el SDK de Firebase. Es «mejor esfuerzo»: si una falla, el resto se guarda igual.
 *   · El nombre de la caché de la página sigue la versión de la app.
 *
 * SI ALGO SALE MAL: borrar este archivo del repositorio basta; la app sigue funcionando igual
 * que antes (la registra de forma tolerante a fallos).
 */
const CACHE = 'bitacora-v40.2';
const LIBS = 'bitacora-libs';
// Versiones fijas (las mismas que carga la app, con su SRI). Si se cambia una versión en la
// app, hay que cambiarla aquí o se descargará igual la primera vez que se use.
const PRECARGA = [
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://cdn.jsdelivr.net/npm/zxing-wasm@2.1.0/dist/es/reader/index.js',
  'https://cdn.jsdelivr.net/npm/zxing-wasm@2.1.0/dist/es/share.js',
  'https://fastly.jsdelivr.net/npm/zxing-wasm@2.1.0/dist/reader/zxing_reader.wasm',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js',
];
const CDN = ['www.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fastly.jsdelivr.net',
             'fonts.googleapis.com', 'fonts.gstatic.com'];
const ESPERA_RED_MS = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.add(new Request('./', {cache: 'no-store'})))
      .catch(() => {})
      .then(() => precargarLibrerias())
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('bitacora-') && k !== CACHE && k !== LIBS).map((k) => caches.delete(k))))
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

// Cada librería por separado y sin tumbar la instalación: si una CDN falla, las demás quedan.
async function precargarLibrerias() {
  const c = await caches.open(LIBS);
  await Promise.all(PRECARGA.map(async (u) => {
    try {
      if (await c.match(u)) return;
      const r = await fetch(new Request(u, {mode: 'cors', credentials: 'omit'}));
      if (r && r.ok) await c.put(u, r);
    } catch (_) { /* sin red: se bajará la primera vez que se use */ }
  }));
}

async function libreriaCachePrimero(req) {
  const c = await caches.open(LIBS);
  // Compatibilidad: lo que la v39.4 guardó en su caché de página también vale.
  const guardada = (await c.match(req)) || (await caches.match(req));
  if (guardada) return guardada;
  const r = await fetch(req);
  if (r && r.ok) c.put(req, r.clone());
  return r;
}
