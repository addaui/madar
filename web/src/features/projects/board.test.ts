import { describe, expect, it } from "vitest";
import type { Task } from "../../api/types";
import { afterFor } from "./Board";

const task = (id: string, position: number): Task => ({ id, position, rev: 1, project: "p", title: id, status: "todo", priority: 0, labels: [], archived: false });
const col = [task("a", 1), task("b", 2), task("c", 3)];

describe("where a dropped card lands", () => {
  it("goes before the card it was dropped on", () => {
    expect(afterFor(col, "x", "c")).toBe("b");
    expect(afterFor(col, "x", "b")).toBe("a");
  });
  it("goes first when dropped on the first card", () => {
    expect(afterFor(col, "x", "a")).toBeNull();
  });
  it("goes last when dropped on the column", () => {
    expect(afterFor(col, "x", null)).toBe("c");
  });
  it("does not count the dragged card itself", () => {
    expect(afterFor(col, "c", null)).toBe("b");
    expect(afterFor(col, "b", "c")).toBe("a");
  });
});
