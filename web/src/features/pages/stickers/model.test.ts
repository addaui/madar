import { describe, expect, it } from "vitest";
import { addSticker, bringForward, bringToFront, inOrder, keyBetween, moveTo, ranks, sendBackward, sendToBack, setBehind, type Sticker } from "./model";
import { placementOf, resolvePlacement, type Column } from "./resolve";

const base = { kind: "emoji" as const, value: "🎉", anchor: "b1", x: 0.3, y: 1.5, w: 0.2, rot: 0 };
const make = (n: number, behind = false): Sticker[] => { let l: Sticker[] = []; for (let i = 0; i < n; i++) l = addSticker(l, { ...base, id: "s" + i, behind }); return l; };
const ids = (l: Sticker[]) => inOrder(l).map((s) => s.id);

describe("keyBetween", () => {
  it("is strictly between its neighbours, however often it is asked", () => {
    let a: string | null = null; const b: string | null = null;
    const keys: string[] = [];
    for (let i = 0; i < 40; i++) { const k = keyBetween(a, b); keys.push(k); a = k; }
    expect([...keys].sort()).toEqual(keys);
    const lo = "a"; let hi = "b";
    for (let i = 0; i < 60; i++) { const k = keyBetween(lo, hi); expect(k > lo && k < hi).toBe(true); hi = k; }
  });
  it("puts a key before the first", () => { const k = keyBetween(null, "V"); expect(k < "V").toBe(true); });
});

describe("layers", () => {
  it("a new sticker goes on top", () => { expect(ids(make(3))).toEqual(["s0", "s1", "s2"]); });
  it("bring to front and send to back", () => {
    const l = make(3);
    expect(ids(bringToFront(l, "s0"))).toEqual(["s1", "s2", "s0"]);
    expect(ids(sendToBack(l, "s2"))).toEqual(["s2", "s0", "s1"]);
  });
  it("forward and backward move one place", () => {
    const l = make(3);
    expect(ids(bringForward(l, "s0"))).toEqual(["s1", "s0", "s2"]);
    expect(ids(sendBackward(l, "s2"))).toEqual(["s0", "s2", "s1"]);
    expect(ids(bringForward(l, "s2"))).toEqual(ids(l));
  });
  it("behind the text sorts under the ones in front, whatever the keys say", () => {
    const l = setBehind(make(3), "s2", true);
    expect(ids(l)).toEqual(["s2", "s0", "s1"]);
    expect(setBehind(l, "s2", false).find((s) => s.id === "s2")!.behind).toBe(false);
    expect([...ranks(l)]).toEqual([["s2", 1], ["s0", 1], ["s1", 2]]);
  });
  it("moving into the other layer by stepping over the text", () => {
    const l = setBehind(make(3), "s2", true);   // s2 | s0 s1
    const f = bringForward(l, "s2");   // over s0, so it can no longer be behind the text
    expect(ids(f)).toEqual(["s0", "s2", "s1"]);
    expect(f.find((s) => s.id === "s2")!.behind).toBe(false);
    expect(moveTo(l, "s2", 0).find((s) => s.id === "s2")!.behind).toBe(true);
  });
  it("a moved sticker keeps every other sticker's key", () => {
    const l = make(4), m = bringToFront(l, "s1");
    for (const s of l) if (s.id !== "s1") expect(m.find((x) => x.id === s.id)!.z).toBe(s.z);
  });
});

const col: Column = { width: 800, em: 16, anchorTop: 200, roomStart: 72, roomEnd: 72, aspect: 1 };
const stk = (p: Partial<Sticker> = {}): Sticker => ({ id: "s", z: "V", ...base, ...p });

describe("resolvePlacement", () => {
  it("is in the column's units: the same sticker lands at the same fraction on any width", () => {
    const wide = resolvePlacement(stk(), col), narrow = resolvePlacement(stk(), { ...col, width: 320 });
    expect(wide.start / 800).toBeCloseTo(narrow.start / 320, 5);
    expect(wide.width / 800).toBeCloseTo(narrow.width / 320, 5);
    expect(wide.top).toBe(200 + 1.5 * 16);
  });
  it("never goes below a size a finger can hold", () => { expect(resolvePlacement(stk({ w: 0.04 }), { ...col, width: 300 }).width).toBe(28); });
  it("hugs the edge instead of leaving the screen", () => {
    const b = resolvePlacement(stk({ x: 0.95, w: 0.2 }), { ...col, width: 320, roomEnd: 20 });
    expect(b.start + b.width).toBeLessThanOrEqual(320 + 20 + 0.001);
  });
  it("can shrink, or hide, instead", () => {
    const c = { ...col, width: 320, roomEnd: 20 };
    const sh = resolvePlacement(stk({ x: 0.9, w: 0.3, narrow: "shrink" }), c);
    expect(sh.start + sh.width).toBeLessThanOrEqual(340.001);
    expect(sh.width).toBeLessThan(0.3 * 320);
    expect(resolvePlacement(stk({ x: 0.9, w: 0.3, narrow: "hide" }), c).hidden).toBe(true);
  });
  it("can hang into the margin when there is room, and not when there is none", () => {
    expect(resolvePlacement(stk({ x: -0.05 }), col).start).toBe(-40);
    expect(resolvePlacement(stk({ x: -0.05 }), { ...col, roomStart: 0 }).start).toBeCloseTo(0);
  });
  it("placementOf is the inverse", () => {
    const b = resolvePlacement(stk({ x: 0.4, y: 3, w: 0.25 }), col);
    const p = placementOf(col, b);
    expect(p.x).toBeCloseTo(0.4); expect(p.y).toBeCloseTo(3); expect(p.w).toBeCloseTo(0.25);
  });
});
