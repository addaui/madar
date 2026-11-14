import { useSyncExternalStore } from "react";
import type { Sticker } from "./model";

/** What the sidebar's list needs to reach the page's stickers; the page body registers it while it is open. */
export interface StickerControl {
  apply: (change: (list: Sticker[]) => Sticker[]) => void;
  addAtCenter: () => void;
  /** The entries of a sticker's menu (also used by the list's rows). */
  entries: (id: string) => import("../../../ui/Menu").MenuEntries;
}
interface State { list: Sticker[]; selected: string | null; control: StickerControl | null; editable: boolean }

let state: State = { list: [], selected: null, control: null, editable: false };
const listeners = new Set<() => void>();

/** The stickers of the page being edited, shared between its body (which draws them) and its sidebar (which lists them). One page is open at a time. */
export const stickerStore = {
  get: () => state,
  set(p: Partial<State>) { state = { ...state, ...p }; listeners.forEach((l) => l()); },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};
export const useStickerState = (): State => useSyncExternalStore(stickerStore.subscribe, stickerStore.get);
