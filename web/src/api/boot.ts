import type { QueryClient } from "@tanstack/react-query";
import { link } from "./link";
import { readsForHash, warm } from "./reads";

/**
 * Starts what the first screen needs, all at once: `describe` and the person's preferences, appearance, inbox, Spaces and projects.
 * They are the same queries the components read, so a component finds the answer already on its way instead of starting the next
 * request only after the last one came back. Not signed in: they fail quietly and the sign-in form shows.
 */
export function warmUp(qc: QueryClient): void {
  const read = (op: string, input: object = {}) => qc.prefetchQuery({ queryKey: [op, input], queryFn: () => link.call(op as never, input as never) });
  void qc.prefetchQuery({ queryKey: ["describe"], queryFn: () => link.describe(), staleTime: Infinity });
  // and the reads of the screen the address names
  void warm(qc, readsForHash(location.hash, localStorage.getItem("madar.space") ?? "default")).catch(() => undefined);
  for (const [op, input] of [["prefs.get", {}], ["appearance.get", {}], ["inbox.list", { limit: 30 }], ["spaces.list", {}], ["projects.list", {}], ["editor.elements", {}]] as [string, object][]) read(op, input);
}
