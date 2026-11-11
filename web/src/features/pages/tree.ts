import type { PageItem } from "../../api/types";

/** The children of a page (or of the top, `null`) in the order the person put them. */
export function childrenOf(list: readonly PageItem[], parent: string | null): PageItem[] {
  return list.filter((p) => (p.parent ?? null) === parent).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/** Every page under `id`, at any depth. */
export function descendants(list: readonly PageItem[], id: string): PageItem[] {
  return childrenOf(list, id).flatMap((c) => [c, ...descendants(list, c.id)]);
}

/** The path from the top down to a page: its ancestors, then the page itself. */
export function pathTo(list: readonly PageItem[], id: string): PageItem[] {
  const byId = new Map(list.map((p) => [p.id, p]));
  const out: PageItem[] = [];
  for (let p = byId.get(id); p; p = p.parent ? byId.get(p.parent) : undefined) out.unshift(p);
  return out;
}

/** Where a drop puts a page, relative to the row it lands on: before it, after it, or inside it. */
export type DropZone = "before" | "after" | "child";

/** The `parent` and `before` of `pages.move` for dropping `id` on `target` in a zone. */
export function moveFor(list: readonly PageItem[], id: string, target: PageItem, zone: DropZone): { parent: string | null; before: string | null } {
  if (zone === "child") return { parent: target.id, before: null };
  const siblings = childrenOf(list, target.parent ?? null).filter((p) => p.id !== id);
  const i = siblings.findIndex((p) => p.id === target.id);
  return { parent: target.parent ?? null, before: zone === "before" ? target.id : siblings[i + 1]?.id ?? null };
}
