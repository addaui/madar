import { describe, expect, it, vi } from "vitest";
import { fromB64, onLiveSignal, registerLive, toB64, transportFor, unregisterLive } from "./live";

describe("Live documents on the page screen (ADR 0093)", () => {
  it("base64 round-trips bytes of every value, and long ones", () => {
    const b = new Uint8Array(70_000).map((_, i) => i % 256);
    expect([...fromB64(toB64(b))]).toEqual([...b]);
  });

  it("routes a body Signal to the open page, a big one to a pull, and Presence to its store", () => {
    const live = { receive: vi.fn(), pullSoon: vi.fn(), receivePresence: vi.fn() };
    registerLive("p1", live as never);
    onLiveSignal({ seq: 1, kind: "pages.body", data: { page: "p1", client: "c9", update: toB64(new Uint8Array([1, 2])) }, at: 0, actor: "bob" });
    expect(live.receive).toHaveBeenCalledWith(new Uint8Array([1, 2]), "c9");
    onLiveSignal({ seq: 2, kind: "pages.body", data: { page: "p1", client: "c9", pull: true }, at: 0, actor: "bob" });
    expect(live.pullSoon).toHaveBeenCalled();
    onLiveSignal({ seq: 3, kind: "pages.presence", data: { page: "p1", state: toB64(new Uint8Array([7])) }, at: 0, actor: "bob" });
    expect(live.receivePresence).toHaveBeenCalledWith(new Uint8Array([7]));
    onLiveSignal({ seq: 4, kind: "pages.body", data: { page: "other", update: "AA==" }, at: 0, actor: "bob" });
    expect(live.receive).toHaveBeenCalledTimes(1);
    unregisterLive("p1");
  });

  it("the transport calls the page's operations with base64 and reads base64 back", async () => {
    const call = vi.fn(async (op: string) => (op.endsWith("pull") ? { update: toB64(new Uint8Array([3])), version: toB64(new Uint8Array([4])) } : op.endsWith("push") ? { version: "BQ==" } : {}));
    const t = transportFor({ project: "x" } as never, "p1", call as never);
    const pulled = await t.pull(new Uint8Array([9]));
    expect(call).toHaveBeenCalledWith("knowledge.body.pull", { project: "x", id: "p1", since: "CQ==" });
    expect([...pulled.update, ...pulled.version]).toEqual([3, 4]);
    expect([...(await t.push(new Uint8Array([1]), "c1")).version]).toEqual([5]);
    expect(call).toHaveBeenCalledWith("knowledge.body.push", { project: "x", id: "p1", update: "AQ==", client: "c1" });
  });
});
