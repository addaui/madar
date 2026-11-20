import { describe, expect, it, vi } from "vitest";
import { runElementCompliance, openPage, BASIC, tick } from "@nuah/editor/testing";
import register from "../src/refs/index";
import { KINDS } from "../src/refs/decl";

const mod = { default: register };
const ref = (title = "Roadmap") => ({ type: "paragraph", content: [{ type: "text", text: "see " }, { type: "entityRef", attrs: { kind: "pages.page", id: "p1", title, icon: "" } }] });
runElementCompliance({ plugin: "@madar/refs", module: mod, kinds: KINDS, samples: { "@madar/refs/mention": { node: ref() } } }, { describe, it, expect });

const pageWith = (services: Record<string, unknown>) => openPage([BASIC, { plugin: "@madar/refs", module: mod, kinds: KINDS }], { hooks: { services } as never });

describe("mentions", () => {
  it("a_click_opens_what_it_names", async () => {
    const openRef = vi.fn();
    const m = await pageWith({ openRef });
    m.handle.insert(ref());
    await tick();
    (m.place.querySelector(".entity-ref") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(openRef).toHaveBeenCalledWith("pages.page", "p1");
    m.handle.destroy();
  });

  it("the_slash_item_links_what_the_person_picks", async () => {
    const pickRef = vi.fn(async () => ({ kind: "tasks.task", id: "t9", title: "Pay rent" }));
    const m = await pageWith({ pickRef });
    const { commandsFor } = await import("@nuah/editor/testing");
    let def: any; register({ element: (d: any) => (def = d), menu() {}, margin() {}, service: () => pickRef, lang: () => "en" } as never);
    await def.ways.slash.find((s: any) => s.id === "link").apply(commandsFor(m.engine.view, m.host));
    await tick();
    expect(JSON.stringify(m.handle.json())).toContain('"id":"t9"');
    m.handle.destroy();
  });

  it("a_line_turns_into_a_page", async () => {
    const turnIntoPage = vi.fn(async (title: string) => ({ id: "p7", title }));
    let menu: any;
    register({ element() {}, margin() {}, menu: (f: any) => { menu = f; }, service: (n: string) => (n === "turnIntoPage" ? turnIntoPage : undefined), lang: () => "en" } as never);
    const replaced: unknown[] = [];
    const items = menu({ blockId: "b1", type: "paragraph", kind: null, attrs: {}, text: "Plans for May" }, { replaceBlock: (id: string, j: unknown) => replaced.push([id, j]) });
    await items[0].onclick();
    expect(turnIntoPage).toHaveBeenCalledWith("Plans for May");
    expect(JSON.stringify(replaced)).toContain('"id":"p7"');
  });
});
