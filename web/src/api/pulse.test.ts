import { describe, expect, it } from "vitest";
import { affectedBy } from "./pulse";
import { matches } from "./hooks";

describe("what a Pulse event makes stale", () => {
  it("a task event refreshes tasks, projects and the page checklists", () => {
    expect(affectedBy("tasks.updated")).toContain("projects.");
    expect(affectedBy("tasks.updated")).toContain("pages.tasks");
  });
  it("a page style event is not a page event", () => {
    expect(affectedBy("pages.style.saved")).toEqual(["pages.styles"]);
    expect(affectedBy("pages.updated")).toContain("pages.");
  });
  it("an unknown event refreshes nothing", () => {
    expect(affectedBy("something.else")).toEqual([]);
  });
  it("matches a query key by operation prefix", () => {
    expect(matches(["tasks.list", {}], ["tasks."])).toBe(true);
    expect(matches(["describe"], ["tasks."])).toBe(false);
  });
});
