"use strict";

const CACHE_PREFIX = "service-timer-";
const CACHE_NAME = CACHE_PREFIX + "v2.1.0";
const APP_SHELL = ["./", "./index.html", "./app-core.js", "./manifest.json", "./version.json", "./icon-192.png", "./icon-512.png", "./favicon.png", "./apple-touch-icon.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener("message", event => {
  if(event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    caches.keys().then(names => Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)))),
    self.clients.claim()
  ]));
});

self.addEventListener("fetch", event => {
  if(event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  if(url.pathname.endsWith("/version.json")) {
    event.respondWith(fetch(event.request, {cache:"no-store"}).catch(() => caches.match("./version.json")));
    return;
  }
  if(event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then(response => {
      if(response.ok) caches.open(CACHE_NAME).then(cache => cache.put("./index.html", response.clone()));
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if(response.ok && response.type === "basic") caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
    return response;
  })));
});
