import { describe, expect, it } from "vitest";
import { optionsOf, resetValueOf, resolveOption, withPageDefault, type BlockDecl, type OptionDecl } from "./options";

const align: OptionDecl = { id: "align", type: "choice", label: { en: "Alignment" }, default: "start", inherit: true };
const tone: OptionDecl = { id: "tone", type: "choice", label: { en: "Kind" }, default: "info" };

describe("resolveOption", () => {
  it("is the element's own value first, then the page's default, then the declared default", () => {
    expect(resolveOption(align, "paragraph", { align: "center" }, { paragraph: { align: "end" } })).toEqual({ value: "center", source: "element" });
    expect(resolveOption(align, "paragraph", { align: null }, { paragraph: { align: "end" } })).toEqual({ value: "end", source: "page" });
    expect(resolveOption(align, "paragraph", {}, undefined)).toEqual({ value: "start", source: "default" });
  });
  it("another type's page default is not used", () => {
    expect(resolveOption(align, "heading", {}, { paragraph: { align: "end" } }).source).toBe("default");
  });
  it("an option that cannot be unset counts as changed when it differs from its default", () => {
    expect(resolveOption(tone, "callout", { tone: "warning" }, undefined)).toEqual({ value: "warning", source: "element" });
    expect(resolveOption(tone, "callout", { tone: "info" }, undefined)).toEqual({ value: "info", source: "default" });
  });
});

describe("resetValueOf", () => {
  it("unsets an inheriting option and puts back the default of the others", () => {
    expect(resetValueOf(align)).toBeNull();
    expect(resetValueOf(tone)).toBe("info");
    expect(resetValueOf({ id: "alt", type: "text", label: { en: "" }, default: "" })).toBeNull();
  });
});

describe("optionsOf", () => {
  const blocks: BlockDecl[] = [
    { id: "h1", node: "heading", label: { en: "H1" }, options: [{ id: "level", type: "choice", label: { en: "Level" } }, align] },
    { id: "h2", node: "heading", label: { en: "H2" }, options: [align] },
    { id: "img", node: "image", label: { en: "Image" } },
  ];
  it("merges the options of the blocks of a type, once each", () => { expect(optionsOf(blocks, "heading").map((o) => o.id)).toEqual(["level", "align"]); expect(optionsOf(blocks, "image")).toEqual([]); });
});

describe("withPageDefault", () => {
  it("sets and takes out a default without touching the others", () => {
    const a = withPageDefault(undefined, "image", "size", "large");
    expect(a).toEqual({ image: { size: "large" } });
    const b = withPageDefault(a, "youtube", "size", "small");
    expect(withPageDefault(b, "image", "size", undefined)).toEqual({ youtube: { size: "small" } });
  });
});
