import { describe, expect, it } from "vitest";
import { affectedBy, affectedByEvent } from "./pulse";
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

// ---- no event is forgotten (the table is kept by hand, the events are declared by plugins) ----
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
describe("every event a plugin declares makes some reads stale", () => {
  const events: string[] = JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/events.json"), "utf8")).events;
  /** Events that no cached read depends on. Listed here so that is a decision, not an omission. */
  const NO_READS: string[] = [];
  it("has an entry for each, or says why not", () => {
    const missing = events.filter((e) => !NO_READS.includes(e) && affectedBy(e).length === 0);
    expect(missing, `events with no entry in AFFECTS (api/pulse.ts): ${missing.join(", ")}`).toEqual([]);
  });
  it("lists nothing in NO_READS that does have an entry or is not declared", () => {
    expect(NO_READS.filter((e) => !events.includes(e) || affectedBy(e).length > 0)).toEqual([]);
  });
  it("makes the reads that show the changed thing stale", () => {
    for (const e of events) {
      const owner = e.split(".")[0]!;
      const ops = affectedBy(e);
      // an event refreshes at least the reads of its own plugin (pages.style.* refreshes the styles read)
      expect(ops.some((o) => o.startsWith(owner)), `${e} -> ${ops.join(",")}`).toBe(true);
    }
  });
});

describe("a change to a page's body (ADR 0093)", () => {
  it("does not refetch the open page or the lists: the Live document has the change already", () => {
    const ops = affectedByEvent("pages.updated", { data: { changes: { body: true } } });
    expect(ops).not.toContain("pages.");
    expect(ops).not.toContain("knowledge.");
    expect(ops).toContain("search.");
    expect(ops).toContain("pages.tasks");
  });
  it("a title change still refreshes the pages", () => {
    expect(affectedByEvent("pages.updated", { data: { changes: { title: ["a", "b"] } } })).toContain("pages.");
    expect(affectedByEvent("tasks.updated", { data: {} })).toEqual(affectedBy("tasks.updated"));
  });
});

