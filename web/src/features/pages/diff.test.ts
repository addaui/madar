import { describe, expect, it } from "vitest";
import { compareDocs } from "./diff";

const p = (id: string, text: string) => ({ type: "paragraph", attrs: { blockId: id }, content: [{ type: "text", text }] });
const doc = (...c: unknown[]) => ({ type: "doc", content: c });

describe("comparing two versions of a page", () => {
  it("matches blocks by id and marks words inside a changed block", () => {
    const out = compareDocs(doc(p("a", "one two three"), p("b", "same")), doc(p("a", "one 2 three four"), p("b", "same")));
    expect(out.map((b) => b.kind)).toEqual(["changed", "same"]);
    const words = out[0].words!.filter((w) => w.op !== "same").map((w) => `${w.op}:${w.text.trim()}`);
    expect(words).toEqual(["removed:two", "added:2", "added:four"]);
  });
  it("shows a block that is new, and one that is gone", () => {
    const out = compareDocs(doc(p("a", "keep"), p("b", "gone")), doc(p("a", "keep"), p("c", "new")));
    expect(out.map((b) => `${b.kind}:${b.text}`)).toEqual(["same:keep", "removed:gone", "added:new"]);
  });
  it("works for Arabic words and blocks without ids", () => {
    const q = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const out = compareDocs(doc(q("مرحبا بالعالم")), doc(q("مرحبا يا عالم")));
    expect(out[0].kind).toBe("changed");
    expect(out[0].words!.some((w) => w.op === "added" && w.text.includes("يا"))).toBe(true);
  });
});
