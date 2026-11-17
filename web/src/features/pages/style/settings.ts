/** A page's look, as the Core stores it (the keys `check_settings` accepts). Everything is optional: a page has only what its person changed. */
export interface PageSettings {
  preset?: string; preset_mode?: "light" | "dark";
  /** A font family of a font plugin, by id (ADR 0090); `serif` and `mono` are what pages chose before families. */
  font?: string; font_features?: Record<string, boolean>; width?: "narrow" | "normal" | "wide"; size?: number; line_height?: number; block_gap?: number;
  page_color?: string; page_opacity?: number; bg_color?: string; text_color?: string; band_shadow?: boolean;
  pattern?: "none" | "ruled" | "grid" | "dots"; pattern_color?: string; margin_line?: string; block_rule?: "none" | "line" | "dashed" | "dotted"; flavor?: "terminal";
  bg_image?: string; bg_fit?: "cover" | "contain" | "scale" | "tile"; bg_scale?: number; bg_tile?: number; bg_attach?: "fixed" | "scroll"; bg_dim?: number;
  bg_art?: "leaves"; bg_art_color?: string;
  /** What the page sets for every element of a type: {image: {size: "large"}} (ADR 0073). */
  elements?: Record<string, Record<string, string | number | boolean>>;
  sheet_art?: "autumn"; sheet_image?: string; sheet_corner?: "top-right" | "top-left" | "bottom-right" | "bottom-left"; sheet_size?: number; sheet_mirror?: boolean;
}

export const PAGE_WIDTHS: Record<string, string> = { narrow: "640px", normal: "820px", wide: "1120px" };

export const hexRgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
export const lum = ([r, g, b]: [number, number, number]): number => {
  const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
/** The text colour that reads on a background. */
export const readableOn = (hex: string): string => (lum(hexRgb(hex)) > 0.4 ? "#1b1b1f" : "#f4f4f6");
export const appScheme = (): "light" | "dark" => (document.documentElement.dataset.scheme === "dark" ? "dark" : "light");

export interface PagePreset { id: string; light: PageSettings; dark: PageSettings }

// each look has a light and a dark version; a page keeps the look's name and its mode (light, dark, or none = follow the app)
export const PAGE_PRESETS: PagePreset[] = [
  { id: "default", light: {}, dark: {} },
  { id: "paper", light: { font: "lora", size: 17, line_height: 190, block_gap: 0, page_color: "#fffcf3", text_color: "#34436b", bg_color: "#ebe6d8", pattern: "ruled", pattern_color: "#d6e0ef", margin_line: "#eba5a2", band_shadow: true },
    dark: { font: "lora", size: 17, line_height: 190, block_gap: 0, page_color: "#2a2b31", text_color: "#e4dfd2", bg_color: "#1c1d22", pattern: "ruled", pattern_color: "#3a3e4a", margin_line: "#b8606a", band_shadow: true } },
  { id: "autumn", light: { font: "fraunces", size: 17, line_height: 180, block_gap: 60, page_color: "#fdf7ea", text_color: "#4a2f1d", bg_color: "#e6d3b3", sheet_art: "autumn", sheet_corner: "top-right", sheet_size: 270, sheet_mirror: true, band_shadow: true },
    dark: { font: "fraunces", size: 17, line_height: 180, block_gap: 60, page_color: "#2b211a", text_color: "#ecd9c0", bg_color: "#16100c", sheet_art: "autumn", sheet_corner: "top-right", sheet_size: 270, sheet_mirror: true, band_shadow: true } },
  { id: "terminal", light: { font: "jetbrains-mono", size: 14, line_height: 155, block_gap: 35, page_color: "#f7faf5", text_color: "#1d6a39", bg_color: "#dfe8dc", flavor: "terminal", width: "wide" },
    dark: { font: "jetbrains-mono", size: 14, line_height: 155, block_gap: 35, page_color: "#0b100c", text_color: "#4dff88", bg_color: "#0b100c", flavor: "terminal", width: "wide" } },
  { id: "blueprint", light: { font: "ibm-plex-mono", size: 15, line_height: 180, block_gap: 0, page_color: "#f5f9fe", text_color: "#1d4f82", bg_color: "#dbe8f5", pattern: "grid", pattern_color: "#dde9f5", margin_line: "#8fbdea" },
    dark: { font: "ibm-plex-mono", size: 15, line_height: 180, block_gap: 0, page_color: "#0e2b4a", text_color: "#d3e6ff", bg_color: "#07192c", pattern: "grid", pattern_color: "#1b4670", margin_line: "#4f95db" } },
];

/** What a page is shown with: its look in the chosen mode (or the app's), then the page's own settings on top. */
export function effectiveSettings(st: PageSettings | null | undefined): PageSettings {
  const { preset, preset_mode, ...own } = st ?? {};
  const p = PAGE_PRESETS.find((x) => x.id === preset);
  return { ...(p ? p[preset_mode ?? appScheme()] : {}), ...own };
}
