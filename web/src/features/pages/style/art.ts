import { hexRgb, lum, type PageSettings } from "./settings";

/** A tile of leaves, drawn in one colour, as a CSS image value. */
export function leavesTile(color: string): string {
  const leaf = (x: number, y: number, r: number, k: number, o: number) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${k})" opacity="${o}"><path d="M0 0C10-17 34-19 46-3 34 15 10 17 0 0Z"/><path d="M3 0 40-3" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" fill="${color}">` + [leaf(28, 52, -28, 1, 1), leaf(140, 36, 38, 0.8, 0.8), leaf(92, 112, 160, 1.05, 0.9), leaf(190, 124, -105, 0.9, 1), leaf(36, 190, 62, 0.85, 0.85), leaf(130, 200, -24, 1, 1), leaf(204, 40, 110, 0.6, 0.7), leaf(80, 20, 90, 0.55, 0.7)].join("") + "</svg>";
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

type Corner = NonNullable<PageSettings["sheet_corner"]>;
export const CORNERS: Record<Corner, string> = { "top-right": "top right", "top-left": "top left", "bottom-right": "bottom right", "bottom-left": "bottom left" };
const OPPOSITE: Record<Corner, Corner> = { "top-right": "bottom-left", "top-left": "bottom-right", "bottom-right": "top-left", "bottom-left": "top-right" };

/** Fallen leaves in autumn colours, as a CSS image value for one corner (drawn for the top right, turned for the others). */
export function autumnImage(opacity: number, corner: Corner): string {
  const leaf = (x: number, y: number, r: number, k: number, c: string) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${k})" opacity="${opacity}"><path d="M0 0C8-20 34-26 52-6 40 6 38 18 24 22 20 12 8 10 0 0Z" fill="${c}"/><path d="M2 0 46-4M20-8 28-18M26-2 36-12M16 4 20 14" fill="none" stroke="#3b1d0f" stroke-opacity=".5" stroke-width="1.3" stroke-linecap="round"/></g>`;
  const cluster = [leaf(200, 28, 22, 1.5, "#b5532d"), leaf(262, 92, 100, 1.2, "#d98a2b"), leaf(150, 96, -12, 1.15, "#8c3b22"), leaf(246, 168, 142, 1, "#c9a227"), leaf(104, 22, -52, 0.9, "#a4442a"), leaf(176, 160, 70, 0.8, "#d98a2b")].join("");
  const turn = { "top-right": "", "top-left": "translate(300 0) scale(-1 1)", "bottom-right": "translate(0 300) scale(1 -1)", "bottom-left": "rotate(180 150 150)" }[corner];
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><g transform="${turn}">${cluster}</g></svg>`)}")`;
}

export interface ArtLayer { image: string; size: string; pos: string }

/** The layers for a sheet's art: one for the chosen corner and one more in the opposite corner when asked. */
export function sheetArt(st: PageSettings): ArtLayer[] {
  if (!st.sheet_art && !st.sheet_image) return [];
  const corner: Corner = st.sheet_corner && CORNERS[st.sheet_corner] ? st.sheet_corner : "top-right";
  const px = st.sheet_size ?? 260, dark = !!st.page_color && lum(hexRgb(st.page_color)) <= 0.4;
  const make = (c: Corner): ArtLayer => (st.sheet_image ? { image: `url("${st.sheet_image}")`, size: px + "px auto", pos: CORNERS[c] } : { image: autumnImage(dark ? 0.6 : 0.92, c), size: px + "px " + px + "px", pos: CORNERS[c] });
  return st.sheet_mirror ? [make(corner), make(OPPOSITE[corner])] : [make(corner)];
}
