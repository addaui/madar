import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import type { Preset } from "@nuah/theme-engine";
import { link } from "./link";
import { affectedBy } from "./pulse";
import { invalidate, useRead, useSuspending } from "./hooks";
import type { Describe, PulseState } from "@nuah/link-client";

/** What `describe` says: the operations this person may use, the events, the themes, and who they are. */
export function useDescribe(): Describe {
  return useSuspending({ queryKey: ["describe"], queryFn: () => link.describe(), staleTime: Infinity });
}

export interface ThemeEntry { id: string; name?: string; tokens: Preset }
export const themesOf = (d: Describe): ThemeEntry[] => ((d.themes as { id: string; name?: string; tokens: Preset }[] | undefined) ?? []).filter((t) => t.tokens?.schema === "theme/1");

/** The person's preferences (`prefs.get`): theme, scheme, language, density, defaults. */
export interface Prefs {
  theme?: string; scheme?: "auto" | "light" | "dark"; language?: "en" | "ar" | string; density?: string; avatar_color?: string;
  "emoji.set"?: string; "projects.default_tab"?: string; "tasks.default_priority"?: number; "tasks.due_soon_days"?: number;
  calendar?: string; confirm_before_delete?: boolean;
}
export function usePrefs(): Prefs {
  return useSuspending({ queryKey: ["prefs.get", {}], queryFn: () => link.call("prefs.get", {}) as Promise<Prefs> });
}
export function useOverrides(): Record<string, string | number | boolean> {
  return (useRead("appearance.get").data as { overrides: Record<string, string | number | boolean> }).overrides;
}

/** Whether the Core offers an operation to this person (a Face shows no control for one it may not use). */
export function useHasOp(op: string): boolean {
  const d = useDescribe();
  const o = d.operations[op];
  return !!o && o.allowed !== false;
}

/** Keeps what is shown in step with the Core: Pulse events refetch the reads they make stale. */
/** Whether live updates are flowing. A store, not an event: the status in the sidebar may appear after the connection is already up. */
let pulse: PulseState = "connecting";
const pulseListeners = new Set<() => void>();
export const pulseState = {
  get: () => pulse,
  set(s: PulseState) { pulse = s; pulseListeners.forEach((l) => l()); },
  subscribe: (l: () => void) => { pulseListeners.add(l); return () => { pulseListeners.delete(l); }; },
};
export const usePulseState = (): PulseState => useSyncExternalStore(pulseState.subscribe, pulseState.get, () => "connecting");

export function usePulse(enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const stop = link.watch({
      onEvent: (kind) => { const ops = affectedBy(kind); if (ops.length) void invalidate(client, ops); },
      onReset: () => { void client.invalidateQueries(); },
      onState: pulseState.set,
    });
    return stop;
  }, [client, enabled]);
}
