import { useSyncExternalStore } from "react";
import type { Sticker } from "./model";

/** What the sidebar's list needs to reach the page's stickers; the page body registers it while it is open. */
export interface StickerControl {
  apply: (change: (list: Sticker[]) => Sticker[]) => void;
  addAtCenter: () => void;
  /** The entries of a sticker's menu (also used by the list's rows). */
  entries: (id: string) => import("../../../ui/Menu").MenuEntries;
  /** What the Element tab edits: changes in the size class being shown, attaching somewhere else, wrap, order, and which class that is. */
  set: (id: string, patch: Partial<Sticker>) => void;
  attach: (id: string, mode: "page" | "block" | "word" | "start") => void;
  wrap: (id: string, wrap: Sticker["wrap"]) => void;
  order: (id: string, op: "front" | "forward" | "backward" | "back") => void;
  sizeClass: () => "narrow" | "medium" | "wide";
}
export type Preview = "auto" | "wide" | "medium" | "narrow";
interface State { list: Sticker[]; selected: string | null; control: StickerControl | null; editable: boolean; preview: Preview }

let state: State = { list: [], selected: null, control: null, editable: false, preview: "auto" };
const listeners = new Set<() => void>();

/** The stickers of the page being edited, shared between its body (which draws them) and its sidebar (which lists them). One page is open at a time. */
export const stickerStore = {
  get: () => state,
  set(p: Partial<State>) { state = { ...state, ...p }; listeners.forEach((l) => l()); },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};
export const useStickerState = (): State => useSyncExternalStore(stickerStore.subscribe, stickerStore.get);
