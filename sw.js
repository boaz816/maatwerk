/* Maatwerk — service worker: de app start altijd uit één complete, bewaarde versie (ook zonder internet).
   Een nieuwe versie wordt in één keer binnengehaald en neemt het pas over als alles binnen is;
   js/core/pwa.js laat dan "Bijwerken" zien. VERSIE en BESTANDEN vult tools/bouw-site.sh in. */
const VERSIE = "dev";
const BESTANDEN = [];
const CACHE = "maatwerk-" + VERSIE;
const FONTS = "maatwerk-fonts";

self.addEventListener("install", (e) => {
  // Alles of niets: mislukt één bestand, dan blijft de vorige versie gewoon staan
  e.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(["./", ...BESTANDEN].map((url) => new Request(url, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Alleen onze eigen oude versies: andere apps op hetzelfde adres hebben hun eigen opslag
    for (const key of await caches.keys()) {
      if (key.startsWith("maatwerk-") && key !== CACHE && key !== FONTS) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/* pwa.js vraagt welke versie deze service worker heeft */
self.addEventListener("message", (e) => {
  if (e.data === "versie" && e.ports[0]) e.ports[0].postMessage(VERSIE);
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith("/version.json")) return; // altijd van de server, nooit bewaard
    e.respondWith(uitDeApp(req));
  } else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(eerstBewaard(req));
  }
});

async function uitDeApp(req) {
  const cache = await caches.open(CACHE);
  const bewaard = (await cache.match(req, { ignoreSearch: true }))
    || (req.mode === "navigate" ? await cache.match(new URL("./", self.registration.scope).href) : undefined);
  return bewaard || fetch(req);
}

/* Lettertypes van Google veranderen niet: eenmaal binnen, dan uit de bewaarde versie. */
async function eerstBewaard(req) {
  const cache = await caches.open(FONTS);
  const bewaard = await cache.match(req);
  if (bewaard) return bewaard;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone()).catch(() => {});
  return res;
}
