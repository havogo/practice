// Service worker: the app must open and work with no signal at all.
//
// Strategy
//   app shell + formulary : cache first, refreshed in the background
//   everything else       : network first, falling back to cache
//
// Patient data never passes through here — it lives in IndexedDB.

const VERSION = "v1";
const CACHE = `practice-${VERSION}`;

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./styles/app.css",
  "./data/formulary.json",
  "./app/main.js",
  "./app/router.js",
  "./app/ui.js",
  "./app/db.js",
  "./app/store.js",
  "./app/icons.js",
  "./app/components.js",
  "./app/formulary.js",
  "./app/script.js",
  "./app/backup.js",
  "./app/sync.js",
  "./app/views/dashboard.js",
  "./app/views/prescribe.js",
  "./app/views/patients.js",
  "./app/views/patient.js",
  "./app/views/patient-edit.js",
  "./app/views/note.js",
  "./app/views/formulary.js",
  "./app/views/billing.js",
  "./app/views/invoice.js",
  "./app/views/history.js",
  "./app/views/settings.js",
  "./icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // addAll fails the whole install if any single file 404s, so add
      // individually and let the rest through.
      await Promise.all(
        SHELL.map((url) => cache.add(url).catch((err) => console.warn("[sw] skip", url, err)))
      );
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch Supabase traffic

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });

      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(network); // refresh in the background
        return cached;
      }

      const response = await network;
      if (response) return response;

      // Offline and never cached: fall back to the shell for navigations.
      if (request.mode === "navigate") {
        const shell = await cache.match("./index.html");
        if (shell) return shell;
      }
      return new Response("Offline", { status: 503, statusText: "Offline" });
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
