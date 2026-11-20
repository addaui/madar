import { describe, expect, it, vi } from "vitest";
import { runElementCompliance, openPage, BASIC, tick } from "@nuah/editor/testing";
import files from "../src/files/index";
import { KINDS as FILE_KINDS } from "../src/files/decl";

const F = { plugin: "@madar/files", module: { default: files }, kinds: FILE_KINDS };
const image = (src: string, extra: Record<string, unknown> = {}) => ({ type: "image", attrs: { src, alt: "a cat", ...extra } });
const card = (attrs: Record<string, unknown>) => ({ type: "linkPreview", attrs: { url: "https://example.com/a", title: "Example", description: "", site: "example.com", image: "", icon: "", mode: "card", ...attrs } });
runElementCompliance({ ...F, samples: { "@madar/files/image": { node: image("/files/f1", { size: "large" }) } } }, { describe, it, expect });

describe("pictures", () => {
  it("are_drawn_only_from_the_instances_files", async () => {
    const m = await openPage([BASIC, F]);
    m.handle.insert(image("/files/f1"));
    m.handle.insert(image("https://tracker.example/x.png"));
    await tick();
    const imgs = [...m.place.querySelectorAll("img")];
    expect(imgs.map((i) => i.getAttribute("src")).sort()).toEqual(["/files/f1", null].sort());
    expect(imgs.find((i) => !i.getAttribute("src"))!.dataset.remote).toBe("true");
    m.handle.destroy();
  });

  it("the_picker_opens_where_the_editor_says_the_insertion_happens", async () => {
    const pick = vi.fn(async () => null);
    let def: any;
    files({ element: (d: any) => (def = d), menu() {}, margin() {}, service: () => pick, lang: () => "en" } as never);
    await def.ways.slash[0].apply({ spot: () => ({ left: 40, top: 100, bottom: 118 }) });
    expect(pick).toHaveBeenCalledWith({ left: 40, top: 100, bottom: 118 });
  });

  it("a_dropped_picture_is_uploaded", async () => {
    const upload = vi.fn(async () => "/files/up1");
    const m = await openPage([BASIC, F], { hooks: { files: { upload } } as never });
    await m.host.files!([new File(["png"], "cat.png", { type: "image/png" })], 1);
    await tick();
    expect(upload).toHaveBeenCalled();
    expect(JSON.stringify(m.handle.json())).toContain('"src":"/files/up1"');
    m.handle.destroy();
  });
});
