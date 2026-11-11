import { command, opMutation, opQuery } from "@nuah/link-client/query";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery, type QueryKey, type UseSuspenseQueryOptions } from "@tanstack/react-query";
import { link } from "./link";
import type { Ops } from "./contract";

/** Operations that only read. */
export type QueryOp = { [K in keyof Ops]: Ops[K]["kind"] extends "query" ? K : never }[keyof Ops] & string;
/** Operations that change something. */
export type CommandOp = { [K in keyof Ops]: Ops[K]["kind"] extends "command" ? K : never }[keyof Ops] & string;

/** A read, cached by operation and input. Use inside Suspense; the data is always there. */
export function useRead<K extends QueryOp>(op: K, input?: Ops[K]["input"]) {
  return useSuspenseQuery(opQuery<Ops, K>(link, op, input) as UseSuspenseQueryOptions<Ops[K]["output"], Error, Ops[K]["output"]>);
}

/** A read the caller builds options for (the describe document, preferences), suspending the same way. */
export function useSuspending<T>(options: UseSuspenseQueryOptions<T, Error, T>): T {
  return useSuspenseQuery(options).data;
}

/** A read that may be skipped (`enabled: false`) and does not suspend. */
export function useMaybeRead<K extends QueryOp>(op: K, input: Ops[K]["input"] | undefined, enabled = true) {
  return useQuery({ ...opQuery<Ops, K>(link, op, input), enabled: enabled && input !== undefined });
}

/**
 * A Command as a mutation. Call `run(input)` inside an Action (`startTransition`, `<form action>`): the idempotency key is
 * made there, before the first attempt, so a retry reuses it (ADR 0059). `invalidates` are operation names whose cached
 * reads are refetched when it succeeds.
 */
export function useCommand<K extends CommandOp>(op: K, invalidates: readonly string[] = []) {
  const client = useQueryClient();
  const m = useMutation({
    ...opMutation<Ops, K>(link, op),
    onSuccess: () => invalidate(client, invalidates),
  });
  return { run: (input: Ops[K]["input"]) => m.mutateAsync(command(input)), pending: m.isPending, error: m.error, reset: m.reset };
}

/** Refetches every cached read whose operation starts with one of the prefixes (for example "tasks."). */
export function invalidate(client: ReturnType<typeof useQueryClient>, prefixes: readonly string[]) {
  return client.invalidateQueries({ predicate: (q) => matches(q.queryKey, prefixes) });
}
export const matches = (key: QueryKey, prefixes: readonly string[]) => typeof key[0] === "string" && prefixes.some((p) => (key[0] as string).startsWith(p));
