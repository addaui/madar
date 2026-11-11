import { useSyncExternalStore } from "react";

/** A value kept in localStorage that components subscribe to. One store per key; tabs stay in step through the `storage` event. */
export function createPersistedState<T extends string>(key: string, fallback: T, valid?: readonly T[]) {
  let memory: T | undefined;   // where the value lives when storage is not available (private mode)
  const read = (): T => {
    if (memory) return memory;
    try { const v = localStorage.getItem(key) as T | null; return v && (!valid || valid.includes(v)) ? v : fallback; } catch { return fallback; }
  };
  const listeners = new Set<() => void>();
  let snapshot = read();
  const notify = () => { snapshot = read(); listeners.forEach((l) => l()); };
  addEventListener("storage", (e) => { if (e.key === key) notify(); });
  const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
  return {
    get: () => snapshot,
    set(v: T) { memory = undefined; try { localStorage.setItem(key, v); } catch { memory = v; } notify(); },
    subscribe,
    fallback,
  };
}

/** A persisted value as a hook. (A hook has to be a function named use…, or the React Compiler would treat the call as plain code.) */
export function usePersistedValue<T extends string>(store: { get: () => T; subscribe: (l: () => void) => () => void; fallback: T }): T {
  return useSyncExternalStore(store.subscribe, store.get, () => store.fallback);
}

/** The sidebar: pinned open, or minimized to a rail that opens over the page while the pointer rests on it. */
export const sideState = createPersistedState<"open" | "closed">("madar.side", "open", ["open", "closed"]);
/** Which list the sidebar shows. */
export const sideTabState = createPersistedState<"tasks" | "pages">("madar.sidetab", "tasks", ["tasks", "pages"]);
/** Focus mode hides everything but the page. */
export const focusState = createPersistedState<"0" | "1">("madar.focus", "0", ["0", "1"]);
/** The page's side panel (Info and Page). */
export const pageSideState = createPersistedState<"0" | "1">("madar.pageside", "1", ["0", "1"]);
/** The Space you are in; it decides which projects and pages the sidebar lists. */
export const spaceState = createPersistedState<string>("madar.space", "default");

/** A phone-width screen: the sidebar is a drawer that opens over the page, not a column. */
const narrowQuery = () => matchMedia("(max-width: 767px)");
export function useIsNarrow(): boolean {
  return useSyncExternalStore((cb) => { const m = narrowQuery(); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); }, () => narrowQuery().matches, () => false);
}

/** Whether the drawer is open (phones only; not remembered: every visit starts with the page). */
let drawer = false;
const drawerListeners = new Set<() => void>();
export const drawerState = {
  get: () => drawer,
  set(v: boolean) { drawer = v; drawerListeners.forEach((l) => l()); },
  subscribe: (l: () => void) => { drawerListeners.add(l); return () => { drawerListeners.delete(l); }; },
};
export const useDrawer = (): boolean => useSyncExternalStore(drawerState.subscribe, drawerState.get, () => false);
