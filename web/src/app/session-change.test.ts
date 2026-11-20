import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("./offline", () => ({ forgetThisDevice: vi.fn(async (qc: QueryClient) => qc.clear()) }));
const { onRefused, startSession } = await import("./session-change");
const { forgetThisDevice } = await import("./offline");

const refused = Object.assign(new Error("sign in first"), { category: "unauthenticated" });
function cacheWithRefusals() {
  const qc = new QueryClient();
  qc.setQueryData(["describe"], { who: null });
  // reads that were refused while the app still thought someone was signed in
  qc.getQueryCache().build(qc, { queryKey: ["pages.get", { id: "p1" }] }).setState({ status: "error", error: refused, fetchStatus: "idle" } as never);
  qc.getQueryCache().build(qc, { queryKey: ["prefs.get", {}] }).setState({ status: "error", error: refused, fetchStatus: "idle" } as never);
  return qc;
}

describe("a change of who is signed in", () => {
  it("signing_in_drops_every_read_kept_from_before_so_no_old_refusal_comes_back", async () => {
    const qc = cacheWithRefusals();
    await startSession(qc);
    const keys = qc.getQueryCache().getAll().map((q) => q.queryKey[0]);
    expect(keys).toEqual(["describe"]);
  });

  it("a_refusal_while_already_signed_out_does_nothing_so_nothing_loops", async () => {
    const qc = cacheWithRefusals();
    await onRefused(qc);
    expect(forgetThisDevice).not.toHaveBeenCalled();
    qc.setQueryData(["describe"], { who: { subject: "alice" } });
    await onRefused(qc);
    expect(forgetThisDevice).toHaveBeenCalledTimes(1);
  });
});
