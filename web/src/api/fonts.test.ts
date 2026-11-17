import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FontLibrary, type Family } from "@nuah/font-engine";
import { describe, expect, it } from "vitest";
import { PAGE_PRESETS } from "../features/pages/style/settings";
import { familyIdOf, pageFontStack } from "./fonts";

const catalogue = JSON.parse(readFileSync(resolve(process.cwd(), "../../nuah-plugins/crates/nuah-fonts/catalogue.json"), "utf8")) as { families: Family[] };
const lib = new FontLibrary(catalogue.families, { fetch: async () => ({ key: "k" }), status: async () => [] }, { make: (f) => ({ family: f, status: "", load: async () => undefined }), add: () => undefined, remember: { has: () => false, add: () => undefined } });

describe("page fonts (ADR 0090)", () => {
  it("every look names a family the catalogue has, not just a kind of typeface", () => {
    for (const p of PAGE_PRESETS) for (const mode of [p.light, p.dark]) if (mode.font) expect(lib.family(familyIdOf(mode.font)), `${p.id}: ${mode.font}`).toBeDefined();
  });
  it("keeps what pages chose before families existed", () => {
    expect(familyIdOf("serif")).toBe("fraunces");
    expect(familyIdOf("mono")).toBe("jetbrains-mono");
    expect(familyIdOf("lora")).toBe("lora");
    expect(pageFontStack(lib, "serif")).toMatch(/^"Fraunces","Fraunces Fallback",var\(--font-ui/);
  });
  it("puts the interface font after the family so the other script still draws, and system fonts last", () => {
    const s = pageFontStack(lib, "eb-garamond")!;
    expect(s.indexOf('"EB Garamond"')).toBe(0);
    expect(s.indexOf("var(--font-ui")).toBeGreaterThan(0);
    expect(s).toMatch(/serif$/);
  });
  it("means the theme's font for nothing or default, and for a family nobody has", () => {
    expect(pageFontStack(lib, undefined)).toBeUndefined();
    expect(pageFontStack(lib, "default")).toBeUndefined();
    expect(pageFontStack(null, "unknown")).toBeUndefined();
    expect(pageFontStack(null, "mono")).toBe("var(--mono)");
  });
});
