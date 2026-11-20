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
