/**
 * Overlays that code outside React asks for (the editor bundle, event handlers): a text prompt, a confirmation and a context menu.
 * Callers get a promise; the host component (`OverlayHost`, loaded on demand because it carries the accessible-menu library) shows them.
 * A request made before the host has loaded waits for it.
 */
export interface MenuEntry {
  label?: string;
  icon?: string;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  onclick?: () => void;
  sub?: () => (MenuEntry | "-" | null | undefined)[];
}
export type MenuItems = (MenuEntry | "-" | null | undefined)[];

export type OverlayRequest =
  | { kind: "text"; label: string; initial: string; resolve: (v: string | null) => void }
  | { kind: "confirm"; label: string; resolve: (v: boolean) => void }
  | { kind: "menu"; x: number; y: number; items: MenuItems }
  | { kind: "image"; label: string; resolve: (v: string | null) => void }
  | { kind: "ref"; resolve: (v: { kind: string; id: string; title: string } | null) => void };

let sink: ((r: OverlayRequest) => void) | null = null;
const waiting: OverlayRequest[] = [];
const push = (r: OverlayRequest) => { if (sink) sink(r); else waiting.push(r); };

/** The host registers itself here; what was asked before it loaded is handed over. */
export function connectOverlayHost(fn: ((r: OverlayRequest) => void) | null) {
  sink = fn;
  if (fn) while (waiting.length) fn(waiting.shift()!);
}

export const askText = (label: string, initial = "") => new Promise<string | null>((resolve) => push({ kind: "text", label, initial, resolve }));
export const askConfirm = (label: string) => new Promise<boolean>((resolve) => push({ kind: "confirm", label, resolve }));
export const openContextMenu = (x: number, y: number, items: MenuItems) => push({ kind: "menu", x, y, items });
export const askImage = (label: string) => new Promise<string | null>((resolve) => push({ kind: "image", label, resolve }));
/** Pick a page or a task to refer to from a document. */
export const askRef = () => new Promise<{ kind: string; id: string; title: string } | null>((resolve) => push({ kind: "ref", resolve }));
