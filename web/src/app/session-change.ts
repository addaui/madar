import type { QueryClient } from "@tanstack/react-query";
import { forgetThisDevice } from "./offline";

/**
 * Who is signed in changed: what was read for one session is never shown in another. Reads still on their way are cancelled first,
 * so a late answer (a refusal from before signing in) cannot land in the emptied cache; then only "who is signed in" is kept.
 */
export async function startSession(qc: QueryClient): Promise<void> {
  await qc.cancelQueries();
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "describe" });
  await qc.invalidateQueries({ queryKey: ["describe"] });
}

/** The session ended (signed out, or the server refused a call): forget what this device kept, and ask who is signed in. */
export async function endSession(qc: QueryClient): Promise<void> {
  await qc.cancelQueries();
  await forgetThisDevice(qc);
  await qc.invalidateQueries({ queryKey: ["describe"] });
}

/** A call was refused for want of a session. Only the first refusal of a session ends it: when already signed out, nothing to do. */
export async function onRefused(qc: QueryClient): Promise<void> {
  const d = qc.getQueryData<{ who?: unknown }>(["describe"]);
  if (!d?.who) return;
  await endSession(qc);
}
