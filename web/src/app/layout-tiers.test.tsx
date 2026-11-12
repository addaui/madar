import { act, cleanup, render, renderHook, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSideMode, useTier } from "./ui-state";
import { Stage } from "./Stage";

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

describe("the side panel", () => {
  const stage = () => render(<Stage topbar={<div />} pane={<p>details</p>} paneLabel="Details"><p>work</p></Stage>);

  it("is a column beside the workspace on a wide or medium screen", () => {
    screenOf(1100); stage();
    expect(screen.getByText("details")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  });

  it("is a rail on a compact screen: it opens when the pointer rests on it and closes when the pointer leaves", () => {
    screenOf(900); vi.useFakeTimers(); stage();
    expect(screen.queryByText("details")).toBeNull();
    const rail = screen.getByRole("button", { name: "Details" });
    fireEvent.pointerEnter(rail, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByText("details")).toBeTruthy();
    fireEvent.pointerLeave(screen.getByText("details").closest("aside")!);
    expect(screen.queryByText("details")).toBeNull();
  });
});
