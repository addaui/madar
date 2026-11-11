import { useSyncExternalStore } from "react";

/** The folders and pages the person collapsed in the explorer (the same storage key as the first Face, so the choice carries over). */
const KEY = "madar.pgopen";
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = read();

function read(): ReadonlySet<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]); } catch { return new Set(); }
}
function write(next: Set<string>) {
  snapshot = next;
  try { localStorage.setItem(KEY, JSON.stringify([...next])); } catch { /* the choice lives until reload */ }
  listeners.forEach((l) => l());
}

/** The collapsed folders, as a hook. */
export function useCollapsed(): ReadonlySet<string> {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => snapshot);
}

export const collapsed = {
  toggle(id: string) { const n = new Set(snapshot); const k = "c:" + id; if (n.has(k)) n.delete(k); else n.add(k); write(n); },
  expand(id: string) { const n = new Set(snapshot); n.delete("c:" + id); write(n); },
  has: (id: string) => snapshot.has("c:" + id),
};
