import { beforeEach, describe, expect, it } from "vitest";
import { createPersistedState } from "./ui-state";

describe("persisted state", () => {
  beforeEach(() => localStorage.clear());

  it("starts at the fallback, remembers a choice and ignores a stored value that is not allowed", () => {
    const a = createPersistedState<"open" | "closed">("t.side", "open", ["open", "closed"]);
    expect(a.get()).toBe("open");
    a.set("closed");
    expect(a.get()).toBe("closed");
    expect(localStorage.getItem("t.side")).toBe("closed");
    localStorage.setItem("t.bad", "weird");
    expect(createPersistedState<"a" | "b">("t.bad", "a", ["a", "b"]).get()).toBe("a");
  });

  it("tells subscribers", () => {
    const s = createPersistedState<string>("t.n", "x");
    let n = 0;
    const off = s.subscribe(() => { n++; });
    s.set("y"); s.set("z");
    off(); s.set("w");
    expect(n).toBe(2);
  });
});
