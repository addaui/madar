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

/**
 * How much room the screen has, as one of four layouts (the breaks leave the workspace at least ~520px beside the columns):
 * wide (1280+): the sidebar and the side panel both open · medium (1024–1279): the sidebar is a rail, the panel is open ·
 * compact (768–1023): both are rails that open over the workspace while the pointer rests on them · phone (below 768): both are hidden and open over it.
 */
export type Tier = "wide" | "medium" | "compact" | "phone";
const tierQueries = { wide: "(min-width: 1280px)", medium: "(min-width: 1024px)", compact: "(min-width: 768px)" } as const;
const tierNow = (): Tier => (matchMedia(tierQueries.wide).matches ? "wide" : matchMedia(tierQueries.medium).matches ? "medium" : matchMedia(tierQueries.compact).matches ? "compact" : "phone");
export function useTier(): Tier {
  return useSyncExternalStore((cb) => {
    const ms = Object.values(tierQueries).map((q) => matchMedia(q));
    ms.forEach((m) => m.addEventListener("change", cb));
    return () => ms.forEach((m) => m.removeEventListener("change", cb));
  }, tierNow, () => "wide");
}

/** A phone-width screen: the sidebar is a drawer that opens over the page, not a column. */
export const useIsNarrow = (): boolean => useTier() === "phone";

/** Whether the drawer is open (phones only; not remembered: every visit starts with the page). */
let drawer = false;
const drawerListeners = new Set<() => void>();
export const drawerState = {
  get: () => drawer,
  set(v: boolean) { drawer = v; drawerListeners.forEach((l) => l()); },
  subscribe: (l: () => void) => { drawerListeners.add(l); return () => { drawerListeners.delete(l); }; },
};
export const useDrawer = (): boolean => useSyncExternalStore(drawerState.subscribe, drawerState.get, () => false);

/**
 * What the sidebar is doing now. `closed`: shown as a rail (you minimized it, or the screen is too small for it open). `auto`: the screen decides,
 * so the toggle opens the sidebar over the page instead of changing the saved choice. `phone`: a drawer.
 */
export function useSideMode(): { closed: boolean; auto: boolean; phone: boolean } {
  const tier = useTier();
  const side = usePersistedValue(sideState);
  const phone = tier === "phone", auto = tier === "medium" || tier === "compact";
  return { closed: !phone && (side === "closed" || auto), auto, phone };
}
