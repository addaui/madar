import type { Sticker } from "./model";
import type { Column } from "./resolve";

export interface Measured extends Omit<Column, "anchorTop" | "aspect"> { rect: DOMRect; rtl: boolean }
/** How the column is on screen now: its width and text size, and how much room there is beside it. */
export function measure(layer: HTMLElement): Measured {
  const rect = layer.getBoundingClientRect();
  const rtl = getComputedStyle(layer).direction === "rtl";
  const scroll = layer.closest<HTMLElement>(".page-scroll");
  const sr = scroll?.getBoundingClientRect(), right = sr ? sr.left + scroll!.clientWidth : window.innerWidth;
  const left = Math.max(0, rect.left - (sr?.left ?? 0) - 4), rightRoom = Math.max(0, right - rect.right - 4);
  const content = layer.parentElement?.querySelector<HTMLElement>(".ed-content");
  const em = parseFloat(getComputedStyle(content ?? layer).fontSize) || 16;
  return { rect, rtl, width: rect.width, em, roomStart: rtl ? rightRoom : left, roomEnd: rtl ? left : rightRoom };
}

/** The top of an anchor block below the top of the layer, or null when it is not on screen (gone, or inside a closed toggle). */
export function anchorTop(layer: HTMLElement, id: string | null, rect: DOMRect): number | null {
  if (id === null) return 0;
  const el = layer.parentElement?.querySelector<HTMLElement>(`[data-bid="${CSS.escape(id)}"]`);
  if (!el || el.getClientRects().length === 0) return null;
  return el.getBoundingClientRect().top - rect.top;
}


/**
 * The line a sticker's `y` counts from: the line of the character it is pinned to, else the top of its anchor block (0 for a sticker pinned to the page);
 * null when the anchor is not shown. A sticker that text wraps around counts from its block, because the wrap itself moves the lines of that block.
 */
export function refTop(layer: HTMLElement, s: Pick<Sticker, "anchor" | "at" | "wrap">, rect: DOMRect, lineTop: (id: string, at: number) => number | null): number | null {
  if (s.anchor === null) return 0;
  if (s.at !== undefined && (!s.wrap || s.wrap === "none")) {
    const t = lineTop(s.anchor, s.at);
    if (t !== null) return t - rect.top;
  }
  return anchorTop(layer, s.anchor, rect);
}

/** Where a block's text is inside the layer (see `TextBox`): its start and end edges' distance from the layer's, and its top. */
export function textBoxOf(layer: HTMLElement, id: string, m: Measured): { start: number; end: number; top: number } | null {
  const el = layer.parentElement?.querySelector<HTMLElement>(`[data-bid="${CSS.escape(id)}"]`);
  if (!el || el.getClientRects().length === 0) return null;
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el), px = (v: string) => parseFloat(v) || 0;
  const left = r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft) - m.rect.left, right = m.rect.right - (r.right - px(cs.borderRightWidth) - px(cs.paddingRight));
  return { start: m.rtl ? right : left, end: m.rtl ? left : right, top: r.top + px(cs.borderTopWidth) + px(cs.paddingTop) - m.rect.top };
}
