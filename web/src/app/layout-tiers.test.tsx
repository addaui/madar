import { act, cleanup, render, renderHook, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSideMode, useTier } from "./ui-state";
import { ContextSidebar, Frame, RegionsProvider, Topbar } from "./regions";
import { contextState } from "./ui-state";

/** A screen of this width: every `(min-width: Npx)` query answers by it. */
function screenOf(width: number) {
  vi.stubGlobal("matchMedia", (q: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0);
    return { matches: width >= min, media: q, addEventListener: () => undefined, removeEventListener: () => undefined };
  });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("the four layouts", () => {
  it.each([[1400, "wide"], [1280, "wide"], [1279, "medium"], [1024, "medium"], [1023, "compact"], [768, "compact"], [767, "phone"], [360, "phone"]] as const)("%ipx is %s", (w, tier) => {
    screenOf(w);
    expect(renderHook(() => useTier()).result.current).toBe(tier);
  });

  it("shows the sidebar as a rail below 1280px, as a drawer on a phone, and open when wide", () => {
    screenOf(1400); expect(renderHook(() => useSideMode()).result.current).toMatchObject({ closed: false, auto: false });
    screenOf(1100); expect(renderHook(() => useSideMode()).result.current).toMatchObject({ closed: true, auto: true });
    screenOf(500); expect(renderHook(() => useSideMode()).result.current).toMatchObject({ closed: false, phone: true });
  });
});

describe("the context sidebar", () => {
  const screen_ = (transient = false) => render(
    <RegionsProvider><Frame>
      <Topbar title="t" crumbs={<span>crumbs</span>} />
      <ContextSidebar label="Details" transient={transient}><p>details</p></ContextSidebar>
      <p>work</p>
    </Frame></RegionsProvider>,
  );
  const open = () => document.querySelector("aside");

  it("is a column beside the workspace on a wide or medium screen", () => {
    screenOf(1100); contextState.set("open"); screen_();
    expect(screen.getByText("details")).toBeTruthy();
    expect(open()!.hidden).toBe(false);
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  });

  it("is a rail, not nothing, when you close it", () => {
    screenOf(1100); contextState.set("closed"); screen_();
    expect(open()!.hidden).toBe(true);
    expect(screen.getByRole("button", { name: "Details" })).toBeTruthy();
    contextState.set("open");
  });

  it("is a rail on a compact screen: it opens when the pointer rests on it and closes when the pointer leaves", () => {
    screenOf(900); vi.useFakeTimers(); screen_();
    expect(open()!.hidden).toBe(true);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Details" }), { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(300); });
    expect(open()!.hidden).toBe(false);
    fireEvent.pointerLeave(open()!);
    expect(open()!.hidden).toBe(true);
  });

  it("opens by itself when it is there because you picked something", () => {
    screenOf(900); screen_(true);
    expect(open()!.hidden).toBe(false);
  });

  it("is not drawn at all on a screen that has none", () => {
    screenOf(1100);
    render(<RegionsProvider><Frame><Topbar title="t" crumbs={<span>crumbs</span>} /><p>work</p></Frame></RegionsProvider>);
    expect(document.querySelector("aside")).toBeNull();
  });
});
