import { describe, expect, it } from "vitest";
import { textOf } from "./text";

describe("a body's text", () => {
  it("blocks_on_lines_and_elements_by_their_fallback", () => {
    const doc = { type: "doc", content: [
      { type: "heading", content: [{ type: "text", text: "Plan" }] },
      { type: "paragraph", content: [{ type: "text", text: "see " }, { type: "elementInline", attrs: { fallback: { text: "Home page" } } }] },
      { type: "element", attrs: { kind: "@nuah/mermaid/diagram", fallback: { text: "flowchart LR" } } },
    ] };
    expect(textOf(doc)).toBe("Plan\nsee Home page\nflowchart LR");
  });
});
