const CACHE_NAME = "campus-life-v2"; // bumped to force refresh on all devices

// Only cache public pages — never admin or event-hub
const STATIC_ASSETS = [
  "/index.html",
  "/clubs.html",
  "/news.html",
  "/forms.html",
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

  // Only http/https requests can be cached — ignore chrome-extension://,
  // moz-extension://, etc. (browser extensions), which the Cache API
  // rejects and would otherwise throw an unhandled error.
  const isCacheable = url.protocol === "http:" || url.protocol === "https:";

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
          if(isCacheable){
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
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

  // Not cacheable (e.g. browser extension requests) — just pass through
  if(!isCacheable){
    event.respondWith(fetch(event.request));
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
  // Wrap in try/catch — if parsing fails (e.g. DevTools test push sends
  // plain text), we fall back to a generic notification instead of crashing.
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch (e) {
    console.warn("[SW] Push payload was not JSON, using defaults:", e.message);
  }

  const title = data.title || "Campus Life";

  // NOTE: actions and vibrate are intentionally excluded.
  // iOS Safari PWA does not support them and silently drops
  // the entire notification if they are present.
  const options = {
    body:  data.body  || "You have a new notification.",
    icon:  data.icon  || "/icon-192.png",
    badge: "/icon-192.png",
    tag:   data.tag   || "campus-life-notification",
    data:  { url: data.url || "/index.html" },
  };

  event.waitUntil((async () => {
    // If the person already has this app open and focused, the in-page
    // realtime listener is already handling this event with an in-page
    // toast + sound — an OS popup on top of that would be a duplicate.
    // Only show the native notification when no focused tab has the app open.
    const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const hasFocusedClient = clientList.some(c => c.focused);
    if(hasFocusedClient) return;
    return self.registration.showNotification(title, options);
  })());
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
