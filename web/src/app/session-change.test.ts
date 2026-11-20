import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("./offline", () => ({ forgetStored: vi.fn(async () => {}) }));
const { endSession, onRefused, startSession } = await import("./session-change");

const refused = Object.assign(new Error("sign in first"), { category: "unauthenticated" });
function client(who: () => unknown) {
  const qc = new QueryClient();
  qc.setQueryDefaults(["describe"], { queryFn: async () => ({ who: who() }), staleTime: Infinity });
  qc.setQueryData(["describe"], { who: { subject: "alice" } });
  qc.getQueryCache().build(qc, { queryKey: ["pages.get", { id: "p1" }] }).setState({ status: "error", error: refused, fetchStatus: "idle" } as never);
  return qc;
}

describe("a change of who is signed in", () => {
  it("signing_in_drops_every_read_kept_from_before_so_no_old_refusal_comes_back", async () => {
    const qc = client(() => ({ subject: "alice" }));
    await startSession(qc);
    expect(qc.getQueryCache().getAll().map((q) => q.queryKey[0])).toEqual(["describe"]);
  });

  it("ending_a_session_tells_the_app_at_once_that_nobody_is_signed_in", async () => {
    const qc = client(() => null);
    const seen: unknown[] = [];
    const obs = new QueryObserver(qc, { queryKey: ["describe"], queryFn: async () => ({ who: null }), staleTime: Infinity });
    const off = obs.subscribe((r) => seen.push((r.data as { who: unknown } | undefined)?.who));
    await endSession(qc);
    expect(seen.at(-1)).toBeNull();
    expect(qc.getQueryCache().getAll().map((q) => q.queryKey[0])).toEqual(["describe"]);
    off();
  });

  it("a_refusal_ends_the_session_only_when_the_server_says_nobody_is_signed_in", async () => {
    // a late refusal of a read from before signing in: the server says alice is signed in, so nothing is wiped
    let who: unknown = { subject: "alice" };
    const qc = client(() => who);
    await onRefused(qc);
    expect(qc.getQueryData<{ who: unknown }>(["describe"])?.who).toEqual({ subject: "alice" });
    expect(qc.getQueryCache().getAll().length).toBe(2);
    who = null;
    await onRefused(qc);
    expect(qc.getQueryData<{ who: unknown }>(["describe"])?.who).toBeNull();
    // already signed out: a further refusal asks nothing more
    const before = qc.getQueryCache().find({ queryKey: ["describe"] })!.state.dataUpdateCount;
    await onRefused(qc);
    expect(qc.getQueryCache().find({ queryKey: ["describe"] })!.state.dataUpdateCount).toBe(before);
  });
});
