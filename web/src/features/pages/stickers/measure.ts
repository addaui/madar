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

