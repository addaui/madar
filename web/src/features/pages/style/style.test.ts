// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sheetArt } from "./art";
import { paintPage } from "./paint";
import { effectiveSettings } from "./settings";

describe("page style", () => {
  it("a look is worked out in the chosen mode, with the person's own settings on top", () => {
    const dark = effectiveSettings({ preset: "paper", preset_mode: "dark", size: 20 });
    expect(dark.page_color).toBe("#2a2b31");
    expect(dark.size).toBe(20);
    expect(effectiveSettings({ preset: "paper", preset_mode: "light" }).page_color).toBe("#fffcf3");
    expect(effectiveSettings(null)).toEqual({});
  });

  it("sheet art goes in one corner, or two when asked", () => {
    expect(sheetArt({ sheet_art: "autumn", sheet_corner: "bottom-left" })).toHaveLength(1);
    const two = sheetArt({ sheet_art: "autumn", sheet_mirror: true });
    expect(two.map((l) => l.pos)).toEqual(["top right", "bottom left"]);
    expect(sheetArt({})).toEqual([]);
  });

  it("paints variables and the backdrop through the CSSOM", () => {
    const root = document.createElement("div"), sheet = document.createElement("div"), title = document.createElement("div");
    paintPage(root, sheet, [title], { page_color: "#ffffff", bg_color: "#cdc4ae", text_color: "#112233", pattern: "ruled", margin_line: "#d9534f" });
    expect(root.style.getPropertyValue("--page-fg")).toBe("#112233");
    expect(root.style.backgroundColor).not.toBe("");
    expect(root.classList.contains("page-banded")).toBe(true);
    expect(title.style.getPropertyValue("--surface")).toBe("#ffffff");
    expect(sheet.style.backgroundImage).toContain("linear-gradient");
  });
});
