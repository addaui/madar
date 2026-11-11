import { useSyncExternalStore } from "react";

export type DialogName = "search" | "settings" | "appearance" | "shortcuts";

let current: DialogName | null = null;
const listeners = new Set<() => void>();

/** Opens a window (search, settings, appearance, shortcuts). The windows load on demand; this call is cheap and is the only thing the frame needs. */
export function openDialog(name: DialogName | null) { current = name; listeners.forEach((l) => l()); }

export function useOpenDialog(): DialogName | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => current, () => null);
}
