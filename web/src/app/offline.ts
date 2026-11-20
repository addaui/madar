// SPDX-License-Identifier: Apache-2.0
/**
 * Offline (ADR 0093): the app opens without a connection. A service worker keeps the app's files; the last answers of reads are kept in the browser
 * (IndexedDB) and shown until fresh ones arrive; page text is kept by the Live documents themselves. Changes to records still need a connection.
 * Everything kept here is forgotten on sign-out, or when the session is found gone.
 */
import type { QueryClient } from "@tanstack/react-query";
import { persistQueryClientRestore, persistQueryClientSave, type Persister } from "@tanstack/react-query-persist-client";
import { createStore, del, get, set } from "idb-keyval";

const KEY = "madar.queries";
/** A new build forgets what the last one kept: its operations may differ. */
export const BUSTER = typeof __MADAR_BUILD__ === "string" ? __MADAR_BUILD__ : "dev";
export const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const idb = (() => { try { return typeof indexedDB === "undefined" ? null : createStore("madar-cache", "queries"); } catch { return null; } })();

/** Where the reads are kept: IndexedDB, or nothing where the browser refuses it (a private window). */
export const persister: Persister = {
  persistClient: async (c) => { if (idb) await set(KEY, c, idb).catch(() => undefined); },
  restoreClient: async () => (idb ? await get(KEY, idb).catch(() => undefined) : undefined),
  removeClient: async () => { if (idb) await del(KEY, idb).catch(() => undefined); },
};

/** The same, writing at most once a second while the app runs (every answer changes the cache). */
export const throttled: Persister = (() => {
  let timer: ReturnType<typeof setTimeout> | undefined, next: Parameters<Persister["persistClient"]>[0] | null = null;
  return {
    persistClient: (c) => { next = c; if (timer === undefined) timer = setTimeout(() => { timer = undefined; const v = next; next = null; if (v) void persister.persistClient(v); }, 1000); },
    restoreClient: persister.restoreClient,
    removeClient: () => { clearTimeout(timer); timer = undefined; next = null; return persister.removeClient(); },
  };
})();

export const saveQueries = (qc: QueryClient) => persistQueryClientSave({ queryClient: qc, persister, buster: BUSTER });
export const restoreQueries = (qc: QueryClient) => persistQueryClientRestore({ queryClient: qc, persister, buster: BUSTER, maxAge: MAX_AGE });

/** Forget what this device stored for the person: the saved reads and the pages kept for offline (the reads in memory are the caller's). */
export async function forgetStored() {
  await throttled.removeClient();
  try { indexedDB?.deleteDatabase("madar-live"); } catch { /* nothing kept */ }
}

/** Forget everything this device kept for the person: the reads, and the pages kept for offline. */
export async function forgetThisDevice(qc: QueryClient) {
  qc.clear();
  await forgetStored();
}

/** The service worker, from the app's own folder and for the whole site (the server allows it), so the app opens at `/` offline too. */
export function registerServiceWorker() {
  if (import.meta.env.DEV || !("serviceWorker" in navigator) || !isSecureContext) return;
  void navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js", { scope: "/" }).catch(() =>
    navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js").catch(() => undefined));
}
