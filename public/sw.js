// Trilo Task Flow service worker: makes the site installable as a phone app.
// Always loads fresh from the network so every update you push shows up right away.
// Only if the phone is offline does it fall back to the last saved copy of the app shell.
const CACHE = "taskflow-shell-v2";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/sb/")) return; // never touch data/API calls
  if (url.pathname.startsWith("/download/") || /\.(apk|json)$/.test(url.pathname)) return; // app downloads go straight to the network
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        // keep the app shell for offline use — but not standalone pages like /privacy.html
        if (!/\.html$/.test(url.pathname) && res.ok && (res.headers.get("content-type") || "").includes("text/html")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
        }
        return res;
      }).catch(() => caches.match("/"))
    );
  }
});
