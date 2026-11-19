/**
 * Block options (ADR 0073). A block declares its options on the Core (`editor.block`); the Face shows them in the Element tab. An option is a named, typed,
 * labelled attribute with a default. A value is the element's own, else the page's default for that type, else the declared default.
 */
export interface Labelled { en: string; ar?: string }
export interface OptionDecl {
  id: string; type: "choice" | "toggle" | "number" | "text" | "color" | "date"; label: Labelled; default?: unknown;
  choices?: { value: string | number; label: Labelled }[]; min?: number; max?: number; step?: number; unit?: string;
  /** The node attribute it edits (the id when not given). */
  attr?: string;
  /** The page may set it for every element of the type. */
  inherit?: boolean; plugin?: string;
  /** Shown in the Element tab itself; the others are buttons that open their control (ADR 0094). */
  pinned?: boolean;
}
export interface BlockDecl { id: string; node: string; label: Labelled; icon?: string; insert?: boolean; options?: OptionDecl[] }
export type Source = "element" | "page" | "default";

/** A kind as `editor.elements` lists it (ADR 0094). */
export interface KindDecl { kind: string; shape: "card" | "content"; label: Labelled; icon?: string; nodes?: string[]; options?: OptionDecl[] }

/**
 * The kinds' options as the Element tab's blocks: a content kind gives one per node type (keyed by the type, as pages' defaults are), a
 * card kind one keyed by the kind.
 */
export function blocksOf(kinds: readonly KindDecl[]): BlockDecl[] {
  return kinds.flatMap((k) => (k.shape === "content" ? (k.nodes ?? []).map((n) => ({ id: `${k.kind}#${n}`, node: n, label: k.label, icon: k.icon, options: k.options })) : [{ id: k.kind, node: k.kind, label: k.label, icon: k.icon, options: k.options }]));
}

/** The options of a node type: those of every block that declares it, once each by id. */
export function optionsOf(blocks: readonly BlockDecl[], node: string): OptionDecl[] {
  const seen = new Set<string>(), out: OptionDecl[] = [];
  for (const b of blocks) if (b.node === node) for (const o of b.options ?? []) if (!seen.has(o.id)) { seen.add(o.id); out.push(o); }
  return out;
}

/** What the page says for every element of a type (`settings.elements`). */
export type PageDefaults = Record<string, Record<string, string | number | boolean>>;

const unset = (v: unknown) => v === undefined || v === null;

/** The value an element shows and where it comes from: its own attribute, else the page's default, else the declared default. */
export function resolveOption(o: OptionDecl, node: string, attrs: Record<string, unknown>, page: PageDefaults | undefined): { value: unknown; source: Source } {
  const own = attrs[o.attr ?? o.id];
  if (o.inherit ? !unset(own) : !unset(own) && own !== "" && own !== o.default) return { value: own, source: "element" };
  const fromPage = o.inherit ? page?.[node]?.[o.id] : undefined;
  if (!unset(fromPage)) return { value: fromPage, source: "page" };
  return { value: !unset(own) ? own : o.default, source: "default" };
}

/** What to write into the attribute to put an option back: nothing for an inheriting option, else its default. */
export const resetValueOf = (o: OptionDecl): unknown => (o.inherit || o.default === "" || o.default === undefined ? null : o.default);

/** The page's defaults with one option set (or, with `undefined`, taken out; an empty type goes with it). */
export function withPageDefault(d: PageDefaults | undefined, node: string, id: string, value: string | number | boolean | undefined): PageDefaults {
  const next: PageDefaults = { ...d, [node]: { ...d?.[node] } };
  if (value === undefined) delete next[node]![id]; else next[node]![id] = value;
  if (!Object.keys(next[node]!).length) delete next[node];
  return next;
}
