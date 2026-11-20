import { useSyncExternalStore } from "react";
import { useStickerState } from "../stickers/store";

/** The element the cursor is in, or that is selected: the block and the blocks around it, innermost first (reported by the editor). */
export interface ElementContext { chain: { node: string; pos: number; attrs: Record<string, unknown>; id: string | null; kind?: string | null; options?: import("./options").OptionDecl[] }[]; selected: boolean }
/** One Format item for a whole element (ADR 0097), with whether it is on for all of its text. */
export interface ElementFormat { id: string; label: string; icon?: string; group?: string; groupLabel?: string; attr?: string; applies: string; active: boolean }
export interface ElementApi {
  setAttrs: (pos: number, patch: Record<string, unknown>) => void;
  setOption?: (blockId: string, option: string, value: unknown) => void;
  format?: (blockId: string) => ElementFormat[];
  applyFormat?: (blockId: string, id: string) => void | Promise<void>;
}
interface State { ctx: ElementContext | null; api: ElementApi | null; pick: number }

let state: State = { ctx: null, api: null, pick: 0 };
const listeners = new Set<() => void>();

/** What the Element tab shows. One page is open at a time; the page body fills it and empties it when it goes. */
export const elementStore = {
  get: () => state,
  set(p: Partial<State>) { state = { ...state, ...p }; listeners.forEach((l) => l()); },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};
export const useElementState = (): State => useSyncExternalStore(elementStore.subscribe, elementStore.get);

/** The kind of what is in context for the tab: a sticker while one is selected, else the innermost (or chosen) block; null when there is none. */
export function useElementKind(): string | null {
  const { ctx, pick } = useElementState();
  const { selected, list } = useStickerState();
  if (selected && list.some((s) => s.id === selected)) return "sticker";
  return ctx ? (ctx.chain[Math.min(pick, ctx.chain.length - 1)]?.node ?? null) : null;
}
