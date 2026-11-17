import { FontLibrary, familiesOf, uiFamily, type Family, type FontPluginData } from "@nuah/font-engine";
import { useSyncExternalStore } from "react";
import { link } from "./link";
import { useDescribe } from "./session";

/** The fonts of the enabled font plugins, loaded by script and kept by the instance (ADR 0090). One library for the whole Face. */
let shared: FontLibrary | null = null;
let sharedFrom: unknown;

const backend = {
  fetch: async (url: string) => link.call("fonts.fetch", { url }) as Promise<{ key: string }>,
  status: async (urls: string[]) => (await link.call("fonts.status", { urls })).present,
};

/** The library of the fonts `describe` lists; the same one while the list is the same. */
export function fontLibrary(plugins: FontPluginData[] | undefined): FontLibrary {
  if (!shared || sharedFrom !== plugins) {
    shared = new FontLibrary(familiesOf(plugins), backend);
    sharedFrom = plugins;
  }
  return shared;
}

/** The library already made (for code outside React, such as painting a page). */
export const currentFontLibrary = (): FontLibrary | null => shared;

export function useFontLibrary(): FontLibrary {
  const d = useDescribe() as unknown as { fonts?: FontPluginData[] };
  return fontLibrary(d.fonts);
}

/** Re-renders when a font's state changes (fetched, loaded, failed). */
export function useFontChanges(lib: FontLibrary): void {
  useSyncExternalStore(
    (cb) => lib.subscribe(cb),
    () => lib.version,
    () => 0,
  );
}

const SYSTEM = 'system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif';
const FALLBACK: Record<Family["category"], string> = {
  sans: SYSTEM, serif: 'Georgia,"Times New Roman",serif', mono: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace', display: SYSTEM, handwriting: 'cursive,' + SYSTEM,
};
/** What pages chose before families existed. */
const LEGACY: Record<string, string> = { serif: "fraunces", mono: "jetbrains-mono" };

/** The family a page's `font` names: its id, or the family `serif` and `mono` stand for. */
export const familyIdOf = (id: string): string => LEGACY[id] ?? id;

/** The `font-family` of a page that chose `id`: the family, then the interface font (so text in the other script still draws), then the kind's system fonts. */
export function pageFontStack(lib: FontLibrary | null, id: string | undefined): string | undefined {
  if (!id || id === "default") return undefined;
  const f = lib?.family(familyIdOf(id));
  if (!f) return id === "serif" ? 'Georgia,"Times New Roman",serif' : id === "mono" ? "var(--mono)" : undefined;
  return `${lib!.stack(f)},var(--font-ui,${SYSTEM}),${FALLBACK[f.category]}`;
}

/**
 * Makes the interface font of a language drawable and says which family the theme's `font: ui` means: Satoshi for Latin and Readex Pro for Arabic in the English
 * interface, Readex Pro for both in the Arabic one. One family name, a face per script (unicode-range), so a character is never drawn with another script's font.
 */
export async function applyUiFont(lib: FontLibrary, lang: string): Promise<void> {
  const main = uiFamily(lib.families, lang);
  if (!main) return;
  const name = `Madar UI ${lang}`;
  const parts = [{ id: main.id, scripts: main.scripts }];
  for (const other of lib.families) {
    if (!other.ui || other.ui === lang) continue;
    const missing = other.scripts.filter((s) => !main.scripts.includes(s));
    if (missing.length) parts.push({ id: other.id, scripts: missing });
  }
  const fallback = lib.fallback(main, name);   // the system face sized like the font, so the text does not jump when it arrives
  document.documentElement.style.setProperty("--font-ui", `"${name}",${fallback ? `"${fallback}",` : ""}${SYSTEM}`);
  await lib.composite(name, parts);
}
