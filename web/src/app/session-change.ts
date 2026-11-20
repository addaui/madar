import type { QueryClient } from "@tanstack/react-query";
import { forgetStored } from "./offline";

type Who = { who?: unknown } | undefined;
const keepWho = (q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== "describe";

/**
 * Who is signed in changed: what was read for one session is never shown in another. Reads still on their way are cancelled first,
 * so a late answer (a refusal from before signing in) cannot land in the emptied cache; then only "who is signed in" is kept.
 */
export async function startSession(qc: QueryClient): Promise<void> {
  await qc.cancelQueries();
  qc.removeQueries({ predicate: keepWho });
  await qc.refetchQueries({ queryKey: ["describe"] });
}

/**
 * The session ended: every read but "who is signed in" goes, what the device stored goes, and "who is signed in" is asked again
 * through the query the app watches (never a cleared cache, which the app would not notice).
 */
export async function endSession(qc: QueryClient): Promise<void> {
  await qc.cancelQueries();
  qc.removeQueries({ predicate: keepWho });
  await forgetStored();
  await qc.refetchQueries({ queryKey: ["describe"] });
}

/**
 * A call was refused for want of a session. A refusal can be late (a read sent before signing in), so the server is asked who is
 * signed in first; the session ends only when it says nobody. When the app already knows nobody is, there is nothing to do.
 */
export async function onRefused(qc: QueryClient): Promise<void> {
  if (!qc.getQueryData<Who>(["describe"])?.who) return;
  await qc.refetchQueries({ queryKey: ["describe"] });
  if (qc.getQueryData<Who>(["describe"])?.who) return;
  await endSession(qc);
}
