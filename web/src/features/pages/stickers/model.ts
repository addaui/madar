/**
 * The sticker model (ADR 0071). A sticker is a small record kept in the page's document attributes. It is anchored to a block by the block's id, and its
 * position is in units that survive a different screen: `x` and `w` are fractions of the column's width, `y` is in em from the anchor block's top.
 * Nothing here knows about the screen: `resolve.ts` turns a sticker into a box, and the layer draws it.
 */
export type StickerKind = "emoji" | "image" | "pack";
/** What to do when the column has less room than the sticker was placed in: stay on screen by hugging the edge (the default), shrink, or hide. */
export type Narrow = "hug" | "shrink" | "hide";

export interface Sticker {
  id: string;
  kind: StickerKind;
  /** An emoji, the id of a shape from our own pack, or the address of an uploaded file (`/files/<id>`). */
  value: string;
  /** The id of the block it is anchored to; null is pinned to the page (its `y` counts from the top of the page). */
  anchor: string | null;
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
