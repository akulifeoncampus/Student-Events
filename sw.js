const CACHE_NAME = "campus-life-v1";

// Only cache public pages — never admin or event-hub
const STATIC_ASSETS = [
  "/index.html",
  "/clubs.html",
  "/news.html",
  "/resources.html",
  "/emergency-contacts.html",
  "/manifest.json",
  "/offline.html",
];

// Pages that should NEVER be cached (authenticated portals)
const NO_CACHE_PATHS = [
  "/admin.html",
  "/event-hub.html",
];

// ── Install: cache static assets ──
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log("[SW] Caching static assets");
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn("[SW] Some assets failed to cache:", err);
      });
    })
  );
  self.skipWaiting();
});

// ── Activate: remove old caches ──
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log("[SW] Deleting old cache:", key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for API calls, cache-first for static ──
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Never cache admin or event-hub pages
  if(NO_CACHE_PATHS.some(p => url.pathname.includes(p))){
    event.respondWith(fetch(event.request));
    return;
  }

  // Always go network-first for Supabase API calls
  if(url.hostname.includes("supabase.co")){
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: "Offline" }), {
          headers: { "Content-Type": "application/json" }
        })
      )
    );
    return;
  }

  // Network-first for HTML pages (always get fresh content)
  if(event.request.mode === "navigate"){
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(cached =>
            cached || caches.match("/index.html")
          )
        )
    );
    return;
  }

  // Cache-first for everything else (fonts, images, JS)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if(cached) return cached;
      return fetch(event.request).then(response => {
        if(response && response.status === 200 && response.type === "basic"){
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});

// ── Push Notifications ──
self.addEventListener("push", event => {
  const data = event.data?.json() || {};
  const title   = data.title   || "Campus Life";
  const options = {
    body:    data.body    || "You have a new notification.",
    icon:    data.icon    || "/icon-192.png",
    badge:   "/icon-192.png",
    tag:     data.tag     || "campus-life-notification",
    data:    { url: data.url || "/index.html" },
    actions: data.actions || [],
    vibrate: [200, 100, 200],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: open relevant page ──
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification.data?.url || "/index.html";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for(const client of clientList){
        if(client.url.includes("lifeoncampus.net") && "focus" in client){
          client.navigate(url);
          return client.focus();
        }
      }
      if(clients.openWindow) return clients.openWindow(url);
    })
  );
});
