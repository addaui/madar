import { describe, expect, it } from "vitest";
import type { PageItem } from "../../api/types";
import { childrenOf, descendants, moveFor, pathTo } from "./tree";

const p = (id: string, parent: string | null, position: number): PageItem => ({ id, parent, position, title: id, rev: 1, folder: false });
const list = [p("a", null, 1), p("b", null, 2), p("a1", "a", 1), p("a2", "a", 2), p("a1x", "a1", 1)];

describe("page tree", () => {
  it("orders children by position and finds descendants and paths", () => {
    expect(childrenOf(list, null).map((x) => x.id)).toEqual(["a", "b"]);
    expect(descendants(list, "a").map((x) => x.id)).toEqual(["a1", "a1x", "a2"]);
    expect(pathTo(list, "a1x").map((x) => x.id)).toEqual(["a", "a1", "a1x"]);
  });
  it("works out where a drop goes", () => {
    const a2 = list.find((x) => x.id === "a2")!;
    expect(moveFor(list, "b", a2, "before")).toEqual({ parent: "a", before: "a2" });
    expect(moveFor(list, "b", a2, "after")).toEqual({ parent: "a", before: null });
    expect(moveFor(list, "b", list[0]!, "child")).toEqual({ parent: "a", before: null });
  });
});
