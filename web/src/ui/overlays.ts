/**
 * Overlays that code outside React asks for (the editor bundle, event handlers): a text prompt, a confirmation and a context menu.
 * Callers get a promise; the host component (`OverlayHost`, loaded on demand because it carries the accessible-menu library) shows them.
 * A request made before the host has loaded waits for it.
 */
import type { MenuEntries, MenuEntry } from "./Menu";
export type { MenuEntry };
/** What a menu lists (the rows are drawn by `ui/Menu`). */
export type MenuItems = MenuEntries;

export type OverlayRequest =
  | { kind: "toast"; text: string }
  | { kind: "text"; label: string; initial: string; resolve: (v: string | null) => void }
  | { kind: "confirm"; label: string; action?: string; cancel?: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: "countdown"; label: string; seconds: number; resolve: (v: boolean) => void }
  | { kind: "menu"; x: number; y: number; items: MenuItems }
  | { kind: "image"; label: string; resolve: (v: string | null) => void }
  | { kind: "ref"; resolve: (v: { kind: string; id: string; title: string } | null) => void }
  /** A modal (or the full view of an element) whose inside a plugin draws; `render` returns what to do when it closes. */
  | { kind: "domModal"; title: string; size: "wide" | "page"; render: (el: HTMLElement, close: () => void) => (() => void) | void; handle: { close: () => void } }
  | { kind: "domPopover"; x: number; y: number; render: (el: HTMLElement) => (() => void) | void; handle: { close: () => void } };

let sink: ((r: OverlayRequest) => void) | null = null;
const waiting: OverlayRequest[] = [];
const push = (r: OverlayRequest) => { if (sink) sink(r); else waiting.push(r); };

/** The host registers itself here; what was asked before it loaded is handed over. */
export function connectOverlayHost(fn: ((r: OverlayRequest) => void) | null) {
  sink = fn;
  if (fn) while (waiting.length) fn(waiting.shift()!);
}

export const askText = (label: string, initial = "") => new Promise<string | null>((resolve) => push({ kind: "text", label, initial, resolve }));
/** Asks before something that cannot be taken back. The button says `action` (Delete unless told otherwise), in the warning colour unless `danger` is false. */
export const askConfirm = (label: string, o: { action?: string; cancel?: string; danger?: boolean } = {}) => new Promise<boolean>((resolve) => push({ kind: "confirm", label, action: o.action, cancel: o.cancel, danger: o.danger ?? true, resolve }));
/** Counts down in plain sight and says true when it reaches zero, false if the person stops it first. For what cannot be taken back and should not happen at the first click. */
export const askCountdown = (label: string, seconds = 3) => new Promise<boolean>((resolve) => push({ kind: "countdown", label, seconds, resolve }));
export const openContextMenu = (x: number, y: number, items: MenuItems) => push({ kind: "menu", x, y, items });
/** A menu that opens under the control that was pressed (a "more" button). */
export const openMenuFrom = (control: EventTarget, items: MenuItems) => {
  const r = (control as Element).closest("button")!.getBoundingClientRect();
  openContextMenu(r.left, r.bottom, items);
};
export const askImage = (label: string) => new Promise<string | null>((resolve) => push({ kind: "image", label, resolve }));
/** Pick a page or a task to refer to from a document. */
export const askRef = () => new Promise<{ kind: string; id: string; title: string } | null>((resolve) => push({ kind: "ref", resolve }));

/** A short notice that fades by itself (what was done, and where). The host shows it in a live region. */
/** A short notice ("Saved"); the host shows it as a toast. */
export const toast = (text: string) => push({ kind: "toast", text });

/** A modal a plugin draws into (the editor's elements: a full view, raw data). Returns what closes it. */
export const openDomModal = (title: string, render: (el: HTMLElement, close: () => void) => (() => void) | void, size: "wide" | "page" = "page") => {
  const handle = { close: () => {} };
  push({ kind: "domModal", title, size, render, handle });
  return () => handle.close();
};
/** A popover a plugin draws into, at a spot on the screen. Returns what closes it. */
export const openDomPopover = (at: { left: number; bottom: number }, render: (el: HTMLElement) => (() => void) | void) => {
  const handle = { close: () => {} };
  push({ kind: "domPopover", x: at.left, y: at.bottom, render, handle });
  return () => handle.close();
};
