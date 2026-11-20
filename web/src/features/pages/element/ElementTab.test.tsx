import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n/i18n";

vi.mock("./kinds", () => ({ useKinds: () => [] }));
const { ElementTab } = await import("./ElementTab");
const { elementStore } = await import("./store");
const { stickerStore } = await import("../stickers/store");
const { sideTabs } = await import("../PageSide");

const page = { id: "p1", rev: 1, title: "Plan", settings: {} } as never;
const show = () => render(<I18nProvider lang="en"><ElementTab page={page} writer /></I18nProvider>);

describe("the Element tab (ADR 0097)", () => {
  it("formats_a_whole_text_element_from_its_text_section", async () => {
    const applied: string[] = [];
    let bold = false;
    act(() => elementStore.set({
      ctx: { chain: [{ node: "paragraph", pos: 0, attrs: {}, id: "b1" }], selected: false },
      api: { setAttrs: () => {}, format: () => [{ id: "bold", label: "Bold", icon: "bold", group: "marks", applies: "text", active: bold }], applyFormat: (_id: string, f: string) => { applied.push(f); bold = true; } } as never,
      pick: 0,
    }));
    show();
    const b = screen.getByRole("button", { name: "Bold" });
    expect(b.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(b);
    expect(applied).toEqual(["bold"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true"));
    act(() => elementStore.set({ ctx: null, api: null }));
  });

  it("groups_the_text_formats_by_name_and_leaves_out_an_option_they_already_cover", () => {
    act(() => elementStore.set({
      ctx: { chain: [{ node: "paragraph", pos: 0, attrs: {}, id: "b2", options: [{ id: "align", type: "choice", attr: "align", label: { en: "Alignment" }, choices: [{ value: "start", label: { en: "start" } }] }, { id: "spacing", type: "toggle", attr: "spacing", label: { en: "Spacing" } }] as never }], selected: false },
      api: { setAttrs: () => {}, format: () => [
        { id: "bold", label: "Bold", group: "marks", groupLabel: "Text effects", applies: "text", active: false },
        { id: "align-center", label: "Center", group: "align", groupLabel: "Alignment", attr: "align", applies: "block", active: false },
      ], applyFormat: () => {} } as never,
      pick: 0,
    }));
    show();
    expect(screen.getByRole("group", { name: "Text effects" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Alignment" })).toBeTruthy();
    // the element's own Alignment option is left out (the Alignment group covers it); its other options stay
    expect(screen.queryByText("start")).toBeNull();
    expect(screen.getAllByText("Spacing").length).toBeGreaterThan(0);
    act(() => elementStore.set({ ctx: null, api: null }));
  });

  it("keeps_a_quotes_own_alignment_which_the_text_formats_do_not_set", () => {
    act(() => elementStore.set({
      ctx: { chain: [{ node: "blockquote", pos: 0, attrs: {}, id: "q1", options: [{ id: "align", type: "choice", attr: "align", label: { en: "Alignment" }, choices: [{ value: "start", label: { en: "start" } }] }] as never }], selected: false },
      api: { setAttrs: () => {}, format: () => [{ id: "align-center", label: "Center", group: "align", groupLabel: "Alignment", attr: "align", applies: "block", active: false }], applyFormat: () => {} } as never,
      pick: 0,
    }));
    show();
    expect(screen.getAllByText("start").length).toBeGreaterThan(0);
    act(() => elementStore.set({ ctx: null, api: null }));
  });

  it("shows_the_sticker_list_with_a_selected_stickers_options", () => {
    const control = { apply: () => {}, addAtCenter: () => {}, entries: () => [], set: () => {}, sizeClass: () => "wide" } as never;
    act(() => stickerStore.set({ list: [{ id: "s1", kind: "emoji", value: "🙂" } as never], selected: "s1", control, editable: true }));
    show();
    expect(screen.getByRole("region", { name: "Stickers" })).toBeTruthy();
    act(() => stickerStore.set({ selected: null, control: null, list: [] }));
  });
});

describe("the page side panel", () => {
  it("orders_its_tabs_element_style_info", () => {
    expect(sideTabs((k: string) => k, "").map((t) => t.id)).toEqual(["element", "style", "info"]);
  });
});
