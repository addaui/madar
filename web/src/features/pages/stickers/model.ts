/**
 * The sticker model (ADR 0071). A sticker is a small record kept in the page's document attributes. It is anchored to a block by the block's id, and its
 * position is in units that survive a different screen: `x` and `w` are fractions of the column's width, `y` is in em from the anchor block's top.
 * Nothing here knows about the screen: `resolve.ts` turns a sticker into a box, and the layer draws it.
 */
export type StickerKind = "emoji" | "image" | "pack" | "gif";
/** What to do when the column has less room than the sticker was placed in: stay on screen by hugging the edge (the default), shrink, or hide. */
export type Narrow = "hug" | "shrink" | "hide";

export interface Sticker {
  id: string;
  kind: StickerKind;
  /** An emoji, the id of a shape from our own pack, an uploaded file (`/files/<id>`), or a GIF at its provider (an https address, ADR 0072). */
  value: string;
  /** The id of the block it is anchored to; null is pinned to the page (its `y` counts from the top of the page). */
  anchor: string | null;
  /** Pinned to a word: the character of the anchor block it sits beside (it follows that character through edits and reflow); `y` then counts from that character's line. */
  at?: number;
  /** The left edge (the right edge in right-to-left), as a fraction of the column's width. */
  x: number;
  /** The top edge, in em from the anchor's top. */
  y: number;
  /** The width, as a fraction of the column's width. */
  w: number;
  /** Degrees. */
  rot: number;
  /** Mirrored left to right. */
  flip?: boolean;
  /** Its place among the stickers: a fractional-index key, compared inside its layer. */
  z: string;
  /** Behind the text instead of in front of it. */
  behind?: boolean;
  /** Cannot be moved by accident. */
  lock?: boolean;
  /** Not drawn (still in the list). */
  hidden?: boolean;
  narrow?: Narrow;
  /** The gap text keeps from it when it wraps, in em (0.6 when not set). */
  wm?: number;
  /** How text goes around it (ADR 0071): over it (the default), or around its outline (`contour`), an oval or a rectangle. */
  wrap?: Wrap;
  /** Layouts for narrower columns: what differs from the sticker's own, by size class. */
  sizes?: { narrow?: Override; medium?: Override };
}
export type Wrap = "none" | "contour" | "oval" | "rect";

// ---- size classes: how the column is wide now decides which layout a sticker uses (ADR 0071) ----
export type SizeClass = "narrow" | "medium" | "wide";
/**
 * What a size class may change about a sticker: where it is, how big, turned, flipped, hidden, and what it is attached to (a layout for a narrower page
 * may attach it to another paragraph). `at: null` says "no word" where the sticker itself has one. Layer, lock, wrap and margin are the same in every class.
 */
export type Override = Partial<Pick<Sticker, "x" | "y" | "w" | "rot" | "flip" | "hidden" | "anchor">> & { at?: number | null };
export const OVERRIDE_KEYS = ["x", "y", "w", "rot", "flip", "hidden", "anchor", "at"] as const;
/** The column widths (px) where a class ends. They are tokens of the page, not of any one theme. */
export const NARROW_MAX = 520, MEDIUM_MAX = 760;
export const classOf = (columnWidth: number): SizeClass => (columnWidth < NARROW_MAX ? "narrow" : columnWidth < MEDIUM_MAX ? "medium" : "wide");

/** The sticker as it is in a size class: its own fields, with the class's overrides on top. */
export function effective(s: Sticker, cls: SizeClass): Sticker {
  const o = cls === "wide" ? undefined : s.sizes?.[cls];
  if (!o) return s;
  const { at, ...rest } = o;
  const out: Sticker = { ...s, ...rest };
  if (at === null) delete out.at; else if (at !== undefined) out.at = at;
  else if (rest.anchor !== undefined && rest.anchor !== s.anchor) delete out.at;   // a word belongs to its own block
  return out;
}
/**
 * Applies a change made in a class. What a class may differ in (position, size, turn, flip, hidden) goes to that class's overrides, or to the sticker itself in
 * the wide class; everything else (what it is anchored to, its layer, lock, wrap) is the same in every class and goes to the sticker.
 */
export function applyIn(s: Sticker, cls: SizeClass | null, patch: Partial<Sticker>): Sticker {
  if (!cls || cls === "wide") return { ...s, ...patch };
  const o: Override = { ...s.sizes?.[cls] }, rest: Partial<Sticker> = {};
  for (const [k, v] of Object.entries(patch)) {
    if ((OVERRIDE_KEYS as readonly string[]).includes(k)) (o as Record<string, unknown>)[k] = v === undefined && k === "at" ? null : v;
    else (rest as Record<string, unknown>)[k] = v;
  }
  return { ...s, ...rest, sizes: { ...s.sizes, [cls]: o } };
}
/** Takes a class back to the sticker's own layout. */
export function resetClass(s: Sticker, cls: SizeClass): Sticker {
  if (cls === "wide" || !s.sizes?.[cls]) return s;
  const sizes = { ...s.sizes };
  delete sizes[cls];
  if (Object.keys(sizes).length) return { ...s, sizes };
  const r: Partial<Sticker> = { ...s };
  delete r.sizes;
  return r as Sticker;
}

// ---- fractional keys: a key between two others, so two people reordering at once never collide on a number ----
const D = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? D.indexOf(a[0]!) : 0, db = b !== null ? D.indexOf(b[0]!) : D.length;
  if (db - da > 1) return D[Math.round((da + db) / 2)]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return D[da]! + midpoint(a.slice(1), null);
}

/** A key that sorts strictly between `a` and `b` (either may be null: no limit on that side). Keys never end in "0". */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error("keyBetween needs a < b");
  return midpoint(a ?? "", b);
}

// ---- order: behind-the-text stickers first, then the ones in front; inside a layer by key, then id ----
export const inOrder = (list: readonly Sticker[]): Sticker[] =>
  [...list].sort((p, q) => Number(!!q.behind) - Number(!!p.behind) || (p.z < q.z ? -1 : p.z > q.z ? 1 : p.id < q.id ? -1 : p.id > q.id ? 1 : 0));

/** The CSS z-index of each sticker inside its layer (1, 2, 3 ... bottom to top), by id. */
export function ranks(list: readonly Sticker[]): Map<string, number> {
  const out = new Map<string, number>();
  let b = 0, f = 0;
  for (const s of inOrder(list)) out.set(s.id, s.behind ? ++b : ++f);
  return out;
}

const layerOf = (list: readonly Sticker[], behind: boolean) => inOrder(list).filter((s) => !!s.behind === behind);
const patch = (list: readonly Sticker[], id: string, p: Partial<Sticker>): Sticker[] => list.map((s) => (s.id === id ? { ...s, ...p } : s));

/** Puts a sticker at `index` of the order of the others (0 is the very bottom). */
export function moveTo(list: readonly Sticker[], id: string, index: number): Sticker[] {
  const me = list.find((s) => s.id === id);
  if (!me) return [...list];
  const others = inOrder(list.filter((s) => s.id !== id));
  const i = Math.max(0, Math.min(index, others.length));
  const before = others[i - 1], after = others[i];
  let behind: boolean;
  if (before && after) behind = !!before.behind === !!after.behind ? !!before.behind : !!me.behind;   // on the boundary it stays where it was
  else if (after) behind = !!after.behind || !!me.behind;   // at the very bottom it can stay behind the text
  else behind = false;   // the very top is in front of the text
  const lo = before && !!before.behind === behind ? before.z : null, hi = after && !!after.behind === behind ? after.z : null;
  return patch(list, id, { behind, z: keyBetween(lo, hi) });
}

const at = (list: readonly Sticker[], id: string) => inOrder(list).findIndex((s) => s.id === id);
export const bringToFront = (list: readonly Sticker[], id: string) => moveTo(list, id, list.length - 1);
export const sendToBack = (list: readonly Sticker[], id: string) => moveTo(list, id, 0);
export const bringForward = (list: readonly Sticker[], id: string) => moveTo(list, id, Math.min(at(list, id) + 1, list.length - 1));
export const sendBackward = (list: readonly Sticker[], id: string) => moveTo(list, id, Math.max(at(list, id) - 1, 0));

/** Moves a sticker behind the text (just under it) or back in front of it (just over it), keeping its place among its neighbours as near as it can. */
export function setBehind(list: readonly Sticker[], id: string, behind: boolean): Sticker[] {
  const me = list.find((s) => s.id === id);
  if (!me || !!me.behind === behind) return [...list];
  const target = layerOf(list.filter((s) => s.id !== id), behind);
  const z = behind ? keyBetween(target.at(-1)?.z ?? null, null) : keyBetween(null, target[0]?.z ?? null);
  return patch(list, id, { behind, z });
}

/** A new sticker goes on top of the layer it starts in. */
export function addSticker(list: readonly Sticker[], s: Omit<Sticker, "z" | "id"> & { id?: string }): Sticker[] {
  const z = keyBetween(layerOf(list, !!s.behind).at(-1)?.z ?? null, null);
  return [...list, { ...s, id: s.id ?? newStickerId(), z }];
}

export const newStickerId = (): string => { const a = new Uint8Array(6); crypto.getRandomValues(a); return "s" + Array.from(a, (x) => (x % 36).toString(36)).join(""); };

/** Which stickers hold which uploaded file, for the list in the sidebar's labels. */
export const labelOf = (s: Sticker): string => (s.kind === "emoji" ? s.value : "");
export const replace = patch;
export const remove = (list: readonly Sticker[], id: string): Sticker[] => list.filter((s) => s.id !== id);
export const MIN_W = 0.04, MAX_W = 1.5;
