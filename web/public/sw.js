// SPDX-License-Identifier: Apache-2.0
// The app's service worker (ADR 0093): it keeps the app's files so the app opens without a connection. It never keeps what the Core answers
// (the Link, Pulse, files): those are the server's to give, and the app keeps the last answers of reads itself.
/* global self, caches, fetch, URL, Response */
const BASE = self.location.pathname.replace(/sw\.js$/, "");
const CACHE = "madar-app-1";
const SHELL = BASE;

/** What to do with a request: "network" (never kept), "cache-first" (a file whose name has its hash: it never changes), "stale-while-revalidate"
 *  (the app's other files: shown at once, refreshed for next time), or "app-shell" (opening the app: the server's if it answers, else the kept one). */
self.route = (url, method, mode) => {
  const u = new URL(url);
  if (u.origin !== self.location.origin || method !== "GET") return "network";
  if (/^\/(link|pulse|files|auth|healthz|readyz|upgrade)(\/|$)/.test(u.pathname)) return "network";
  if (mode === "navigate") return u.pathname === "/" || u.pathname.startsWith(BASE) ? "app-shell" : "network";
  if (u.pathname.startsWith(BASE + "assets/")) return "cache-first";
  if (u.pathname.startsWith(BASE)) return "stale-while-revalidate";
  return "network";
};

async function keepAll() {
  const c = await caches.open(CACHE);
  const files = [SHELL, BASE + "vendor-editor.js", BASE + "loro.wasm"];
  try {
    const m = await (await fetch(BASE + "asset-manifest.json", { cache: "no-store" })).json();
    for (const e of Object.values(m)) for (const f of [e.file, ...(e.css || [])]) if (f) files.push(BASE + f);
  } catch { /* without the list, files are kept as they are used */ }
  await Promise.all([...new Set(files)].map((f) => c.add(new Request(f, { cache: "reload" })).catch(() => undefined)));
}

self.addEventListener("install", (e) => { e.waitUntil(keepAll().then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const r = e.request;
  const how = self.route(r.url, r.method, r.mode);
  if (how === "network") return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (how === "cache-first") {
      const hit = await c.match(r);
      if (hit) return hit;
      const res = await fetch(r);
      if (res.ok) void c.put(r, res.clone());
      return res;
    }
    if (how === "app-shell") {
      try {
        const res = await fetch(r);
        if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) void c.put(SHELL, res.clone());
        return res;
      } catch {
        return (await c.match(SHELL)) || Response.error();
      }
    }
    const hit = await c.match(r);
    const fresh = fetch(r).then((res) => { if (res.ok) void c.put(r, res.clone()); return res; }).catch(() => undefined);
    return hit || (await fresh) || Response.error();
  })());
});
