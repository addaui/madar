import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdPage, isUntouched, leavePage, markFresh } from "./freshPage";

describe("a page made by New page", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("is deleted when it is left with nothing written", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    markFresh("a", "Untitled", 1);
    leavePage("a", () => true, remove);
    await vi.runAllTimersAsync();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("stays when something was written, and is never removed later either", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    markFresh("b", "Untitled", 1);
    leavePage("b", () => false, remove);
    await vi.runAllTimersAsync();
    leavePage("b", () => true, remove);   // it is no longer fresh: a later visit that empties it is the person's doing
    await vi.runAllTimersAsync();
    expect(remove).not.toHaveBeenCalled();
  });

  it("is not deleted if it is shown again straight away (a remount)", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    markFresh("c", "Untitled", 1);
    leavePage("c", () => true, remove);
    holdPage("c");
    await vi.runAllTimersAsync();
    expect(remove).not.toHaveBeenCalled();
  });

  it("is untouched only while its title and revision are as made", () => {
    markFresh("d", "Untitled", 1);
    expect(isUntouched("d", "Untitled", 1)).toBe(true);
    expect(isUntouched("d", "Untitled", 2)).toBe(false);
    expect(isUntouched("d", "Plan", 1)).toBe(false);
    expect(isUntouched("nobody", "Untitled", 1)).toBe(false);
  });

  it("a failed delete does not throw", async () => {
    markFresh("e", "Untitled", 1);
    leavePage("e", () => true, () => Promise.reject(new Error("offline")));
    await expect(vi.runAllTimersAsync()).resolves.not.toThrow();
  });
});
