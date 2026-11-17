import { leavesTile, sheetArt } from "./art";
import { currentFontLibrary, familyIdOf, pageFontStack } from "../../../api/fonts";
import { appScheme, effectiveSettings, hexRgb, lum, PAGE_WIDTHS, readableOn, type PageSettings } from "./settings";
import { featureSettings } from "@nuah/font-engine";

/**
 * Paints a page's look onto its elements through the CSSOM (the Content-Security-Policy forbids style attributes).
 * `root` is the page surface (it gets the backdrop), `sheet` the paper, `parts` the elements whose colours become the page's palette
 * (the title and the editor body; menus, handles and the format bar keep the app's theme).
 */
export function paintPage(root: HTMLElement, sheet: HTMLElement | null, parts: HTMLElement[], settings: PageSettings | null | undefined): void {
  const st = effectiveSettings(settings);
  const set = (k: string, v: string | undefined) => (v ? root.style.setProperty(k, v) : root.style.removeProperty(k));
  const lib = currentFontLibrary();
  set("--page-font", pageFontStack(lib, st.font));
  set("--page-font-features", st.font_features ? featureSettings(st.font_features) : undefined);
  // the family is fetched by the instance and loaded when the page asks for it; the browser redraws the text as its faces arrive
  if (lib && st.font && st.font !== "default") void lib.ensure(familyIdOf(st.font));
  set("--page-size", st.size ? st.size + "px" : ""); set("--page-w", st.width ? PAGE_WIDTHS[st.width] : undefined);
  const op = st.page_opacity ?? 100;
  set("--page-bg", st.page_color ? (op >= 100 ? st.page_color : `color-mix(in srgb, ${st.page_color} ${op}%, transparent)`) : "");
  set("--page-lh", st.line_height ? String(st.line_height / 100) : ""); set("--block-gap", st.block_gap !== undefined ? st.block_gap / 100 + "em" : "");
  // the text takes the colour the person chose, or the one that reads on what it sits on: the sheet, or a plain backdrop colour
  const under = st.page_color && op >= 50 ? st.page_color : !st.page_color && st.bg_color && !st.bg_image ? st.bg_color : null;
  const fg = st.text_color || (under ? readableOn(under) : null), base = under || "var(--surface)";
  set("--page-fg", fg ?? "");
  // raised cards on the sheet (link previews): lighter than the sheet, and only a little on a dark one
  const sheetDark = under ? lum(hexRgb(under)) <= 0.4 : appScheme() === "dark";
  set("--card-bg", `color-mix(in srgb, ${under || "var(--surface)"} ${sheetDark ? 90 : 76}%, #fff)`);
  const ruled = !!st.pattern && st.pattern !== "none";
  root.classList.toggle("page-banded", !!(st.page_color || ruled || st.margin_line)); root.classList.toggle("page-shadow", !!st.band_shadow);
  const flag = (k: string, v: string | undefined | false) => (v ? root.setAttribute(k, v) : root.removeAttribute(k));
  flag("data-rule", st.block_rule && st.block_rule !== "none" ? st.block_rule : undefined); flag("data-flavor", st.flavor); flag("data-margin", st.margin_line ? "1" : undefined);
  // the page's content (title, text, callouts, code, quotes) takes these colours as its whole palette
  const tone: Record<string, string | null | undefined> = {
    "--surface": under, "--text": fg, "--page-fg": fg, "--muted": fg && `color-mix(in srgb, ${fg} 62%, ${base})`, "--line": fg && `color-mix(in srgb, ${fg} 14%, ${base})`,
    "--line-strong": fg && `color-mix(in srgb, ${fg} 26%, ${base})`, "--sunken": fg && `color-mix(in srgb, ${fg} 6%, ${base})`, "--hover": fg && `color-mix(in srgb, ${fg} 9%, ${base})`,
    "--soft": under && `color-mix(in srgb, var(--accent) 12%, ${under})`, "--warn-bg": under && `color-mix(in srgb, #e0a100 16%, ${under})`,
  };
  for (const part of parts) for (const [k, v] of Object.entries(tone)) { if (v) part.style.setProperty(k, v); else part.style.removeProperty(k); }
  paintBackdrop(root, st);
  if (sheet) paintPaper(sheet, st);
}

/** Notebook paper on the sheet: ruled, grid or dotted, with a margin line, and the sheet's art. The rows are as tall as a line of text, so the rules sit under the lines. */
export function paintPaper(col: HTMLElement, st: PageSettings): void {
  const s = col.style, pat = st.pattern && st.pattern !== "none" ? st.pattern : null;
  if (!pat && !st.margin_line && !st.sheet_art && !st.sheet_image) { for (const k of ["backgroundImage", "backgroundSize", "backgroundRepeat", "backgroundPosition"] as const) s[k] = ""; return; }
  const L = Math.max(12, ((st.size || 16) * (st.line_height || 170)) / 100), line = st.pattern_color || "color-mix(in srgb, var(--page-fg, var(--text)) 16%, transparent)";
  const ed = col.querySelector(".ed-content"), top = ed ? ed.getBoundingClientRect().top - col.getBoundingClientRect().top : 0, off = ((top % L) + L) % L;
  const layers: string[] = [], sizes: string[] = [], repeats: string[] = [], poses: string[] = [], rtl = document.documentElement.dir === "rtl";
  if (st.margin_line) { layers.push(`linear-gradient(${st.margin_line}, ${st.margin_line})`); sizes.push("2px 100%"); repeats.push("no-repeat"); poses.push((rtl ? "right 56px" : "left 56px") + " top"); }
  if (pat === "ruled" || pat === "grid") { layers.push(`linear-gradient(to bottom, transparent calc(100% - 1px), ${line} 0)`); sizes.push(`100% ${L}px`); repeats.push("repeat-y"); poses.push(`0 ${off}px`); }
  if (pat === "grid") { layers.push(`linear-gradient(to right, transparent calc(100% - 1px), ${line} 0)`); sizes.push(`${L}px 100%`); repeats.push("repeat-x"); poses.push("0 0"); }
  if (pat === "dots") { layers.push(`radial-gradient(circle at 1px 1px, ${line} 1px, transparent 1.6px)`); sizes.push(`${L}px ${L}px`); repeats.push("repeat"); poses.push(`0 ${off}px`); }
  for (const l of sheetArt(st)) { layers.push(l.image); sizes.push(l.size); repeats.push("no-repeat"); poses.push(l.pos); }
  s.backgroundImage = layers.join(","); s.backgroundSize = sizes.join(","); s.backgroundRepeat = repeats.join(","); s.backgroundPosition = poses.join(",");
}

/** The backdrop: a colour, then (on top of it) a picture of leaves and/or the person's image, dimmed if asked. `art` is the leaf tile's size in px. */
export function paintBackdrop(el: HTMLElement, st: PageSettings, art = 240): void {
  const s = el.style; s.backgroundColor = st.bg_color || "";
  const layers: [string, string, string, string, string][] = [];
  if (st.bg_art === "leaves") layers.push([leavesTile(st.bg_art_color || "#b5d4a2"), art + "px " + art + "px", "repeat", "top left", "local"]);
  if (st.bg_image) {
    const attach = st.bg_attach === "scroll" ? "local" : "fixed", fit = st.bg_fit || "cover";
    const size = fit === "contain" ? "contain" : fit === "scale" ? (st.bg_scale || 100) + "% auto" : fit === "tile" ? (st.bg_tile || 200) + "px auto" : "cover";
    layers.unshift([`url("${st.bg_image}")`, size, fit === "tile" ? "repeat" : "no-repeat", fit === "tile" ? "top left" : "center", attach]);
    if (st.bg_dim) { const d = `rgba(0,0,0,${st.bg_dim / 100})`; layers.unshift([`linear-gradient(${d},${d})`, "100% 100%", "no-repeat", "center", attach]); }
  }
  if (!layers.length) { for (const k of ["backgroundImage", "backgroundSize", "backgroundRepeat", "backgroundPosition", "backgroundAttachment"] as const) s[k] = ""; return; }
  s.backgroundImage = layers.map((l) => l[0]).join(","); s.backgroundSize = layers.map((l) => l[1]).join(","); s.backgroundRepeat = layers.map((l) => l[2]).join(",");
  s.backgroundPosition = layers.map((l) => l[3]).join(","); s.backgroundAttachment = layers.map((l) => l[4]).join(",");
}
