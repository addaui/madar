import { describe, expect, it } from "vitest";
import { runElementCompliance, openPage, BASIC, tick } from "@nuah/editor/testing";
import register from "../src/task-block/index";
import { KINDS } from "../src/task-block/decl";

const mod = { default: register };
const task = (title: string, attrs: Record<string, unknown> = {}) => ({ type: "taskBlock", attrs: { checked: false, due: null, priority: null, details: "", ...attrs }, content: [{ type: "text", text: title }] });
runElementCompliance({ plugin: "@madar/task-block", module: mod, kinds: KINDS, samples: { "@madar/task-block/task": { node: task("Call the bank", { due: "2026-12-01", priority: "high", details: "before noon" }) } } }, { describe, it, expect });

describe("the task element", () => {
  it("the_box_marks_it_done", async () => {
    const m = await openPage([BASIC, { plugin: "@madar/task-block", module: mod, kinds: KINDS }]);
    m.handle.insert(task("Write the report"));
    await tick();
    const box = m.place.querySelector(".tb-box") as HTMLButtonElement;
    expect(box.getAttribute("aria-checked")).toBe("false");
    box.click();
    await tick();
    let checked: unknown;
    m.engine.view.state.doc.descendants((n) => { if (n.type.name === "taskBlock") checked = n.attrs.checked; });
    expect(checked).toBe(true);
    expect(box.getAttribute("aria-checked")).toBe("true");
    m.handle.destroy();
  });

  it("shows_due_and_priority_in_arabic", async () => {
    const m = await openPage([BASIC, { plugin: "@madar/task-block", module: mod, kinds: KINDS }], { lang: "ar" });
    m.handle.insert(task("اتصل بالبنك", { due: "2026-12-01", priority: "high" }));
    await tick();
    expect(m.place.querySelector('.tb-chip[data-kind="priority"]')?.textContent).toBe("عالية");
    expect(m.place.querySelector('.tb-chip[data-kind="due"]')).not.toBeNull();
    m.handle.destroy();
  });

  it("declares_which_attributes_hold_the_task", () => {
    expect(KINDS[0]!.nodes).toEqual(["taskBlock"]);
    expect((KINDS[0] as unknown as { task: unknown }).task).toEqual({ done: "checked", due: "due", priority: "priority", notes: "details" });
  });
});
