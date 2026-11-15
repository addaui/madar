import { MIN_W, MAX_W, type Sticker } from "./model";

/** What the screen says about the column the sticker is drawn in. All lengths are CSS pixels. */
export interface Column {
  /** The width of the column's text (what `x` and `w` are fractions of). */
  width: number;
  /** One em of the page's text. */
  em: number;
  /** How far the anchor block's top is below the top of the layer (0 for a sticker pinned to the page). */
  anchorTop: number;
  /** Room outside the column's text, before its start edge and after its end edge, that a sticker may use. */
  roomStart: number;
  roomEnd: number;
  /** The ratio height / width of what is drawn (an emoji is square; a picture has its own). */
  aspect: number;
}

export interface Box { start: number; top: number; width: number; height: number; rot: number; flip: boolean; hidden: boolean }

/** The smallest a sticker is drawn, so it can still be found and held with a finger. */
export const MIN_PX = 28;
export const MAX_PX = 720;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Where a sticker is on this screen (ADR 0071). Position is relative to the column, never to the window: the start edge is `x` of the column's width
 * (from the start side, so it mirrors in right-to-left), the top is `y` ems below the anchor block's top, the width is `w` of the column's width.
 * When the sticker sticks out of the room there is, it hugs the edge (default), shrinks to fit, or hides, as the sticker says.
 * Pure on purpose: the same inputs give the same box on every device, which is what the tests hold it to.
 */
export function resolvePlacement(s: Sticker, c: Column): Box {
  const aspect = c.aspect > 0 ? c.aspect : 1;
  let width = clamp(clamp(s.w, MIN_W, MAX_W) * c.width, MIN_PX, MAX_PX);
  const top = c.anchorTop + s.y * c.em;
  let start = s.x * c.width;
  const lo = -c.roomStart, hi = c.width + c.roomEnd;
  let hidden = !!s.hidden;
  if (start < lo || start + width > hi) {
    const how = s.narrow ?? "hug";
    if (how === "hide") hidden = true;
    else {
      if (how === "shrink") {
        // keep the middle where it was and make it fit the room on that side
        const mid = start + width / 2, room = 2 * Math.max(0, Math.min(mid - lo, hi - mid));
        width = Math.min(width, Math.max(MIN_PX, room));
        start = mid - width / 2;
      }
      start = clamp(start, lo, Math.max(lo, hi - width));
    }
  }
  return { start, top, width, height: width * aspect, rot: s.rot, flip: !!s.flip, hidden };
}

/** The fractions to store for a box the person dropped at `start`/`top`/`width` (pixels), the inverse of `resolvePlacement` before clamping. */
export function placementOf(c: Column, box: { start: number; top: number; width: number }): { x: number; y: number; w: number } {
  return { x: box.start / c.width, y: (box.top - c.anchorTop) / c.em, w: clamp(box.width / c.width, MIN_W, MAX_W) };
}

/** The shape text goes around: the outline of an uploaded picture, else an oval or a rectangle as chosen; "none" when it does not wrap. */
export function wrapShapeOf(s: Sticker): "none" | "contour" | "oval" | "rect" {
  if (!s.wrap || s.wrap === "none" || s.behind || s.hidden || s.anchor === null) return "none";
  return s.wrap === "contour" ? (s.kind === "image" ? "contour" : "oval") : s.wrap;
}

/**
 * What the editor needs to make text go around a sticker. A sticker near an edge is a float at the start of its block: text goes along the other side.
 * A sticker with room on both sides is a hole in each line it crosses: the editor puts a gap of the right width into each such line, so one paragraph
 * flows on both sides (CSS has no way to flow one stream around an object in the middle; this is how it is done in a text that can still be edited).
 */
export interface FloatWrap {
  kind: "float"; id: string; anchor: string;
  /** Which edge of the text it hugs: the one the sticker is nearer to. */
  side: "start" | "end";
  /** Pixels from that edge of the block's text to the sticker, and from the block's text top down to it. */
  inset: number; top: number; width: number; height: number;
  shape: "contour" | "oval" | "rect"; margin: number; image?: string;
}
/** The hole, in pixels from the left edge and the top of the block's text (left to right text only). */
export interface GapWrap { kind: "gap"; id: string; anchor: string; x0: number; x1: number; y0: number; y1: number; shape: "oval" | "rect" }
export type WrapSpec = FloatWrap | GapWrap;

/** Where the anchor block's text is inside the layer: its start edge's distance from the layer's start, its end edge's from the layer's end, and its top. */
export interface TextBox { start: number; end: number; top: number }

/** Both sides need at least this much room (in em) for the text on them to be worth a gap in each line. */
const MIN_BAND_EM = 4;

/** How text goes around a sticker, or null when it does not wrap (over the text, behind it, pinned to the page, hidden, or too wide to leave room). */
export function wrapOf(s: Sticker, box: Box, layerWidth: number, text: TextBox, em: number, rtl = false): WrapSpec | null {
  const shape = wrapShapeOf(s);
  if (shape === "none" || box.hidden || s.anchor === null) return null;
  const margin = Math.round((s.wm ?? 0.6) * em);
  const textWidth = layerWidth - text.start - text.end;
  const x0 = box.start - text.start - margin, x1 = box.start + box.width - text.start + margin;   // from the text's start edge
  const y0 = box.top - text.top - margin, y1 = box.top - text.top + box.height + margin;
  if (!rtl && x0 >= MIN_BAND_EM * em && textWidth - x1 >= MIN_BAND_EM * em) {
    return { kind: "gap", id: s.id, anchor: s.anchor, x0: Math.round(x0), x1: Math.round(x1), y0: Math.round(y0), y1: Math.round(y1), shape: shape === "rect" ? "rect" : "oval" };
  }
  const side = box.start + box.width / 2 < layerWidth / 2 ? "start" : "end";
  const inset = side === "start" ? box.start - text.start : layerWidth - (box.start + box.width) - text.end;
  if (box.width + Math.max(0, inset) > textWidth * 0.8) return null;   // it would leave no room for the text
  const image = shape === "contour" ? s.value : undefined;
  return { kind: "float", id: s.id, anchor: s.anchor, side, inset: Math.round(inset), top: Math.round(box.top - text.top), width: Math.round(box.width), height: Math.round(box.height), shape, margin, image };
}
