import { Link } from "@nuah/link-client";
import { QueryClient } from "@tanstack/react-query";
import type { Ops } from "./contract";

/** The one Link of this Face. `face` must match what the plugin @madar/web-react publishes. */
export const link = new Link<Ops>({
  face: "web-react",
  onUnauthenticated: () => window.dispatchEvent(new Event("madar:unauthenticated")),
  onIncompatible: () => window.dispatchEvent(new Event("madar:incompatible")),
});

/** Reads are cached by operation and input (ADR 0059). A short stale time keeps the screen calm; Pulse invalidates what changes. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 10 * 60_000, retry: (n, e) => n < 2 && (e as { retryable?: boolean }).retryable === true, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});
