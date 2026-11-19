// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState, useSyncExternalStore } from "react";
import type { LiveState } from "@nuah/live-doc";
import { useDescribe } from "../../api/session";
import { isDraftId } from "./draft";
import { openLive, releaseLive } from "./live";
import type { PageScope } from "./scope";

type Opened = Awaited<ReturnType<typeof openLive>>;

/** The page's Live document while the page is shown (ADR 0093). A draft has none (it is plain JSON until it is stored); `failed` means it could
 *  not be opened (offline, and never opened on this device). `generation` changes when the document was replaced (the server refused a change). */
export function useLive(scope: PageScope, id: string): { open: Opened | null; failed: boolean; generation: number; state: LiveState } {
  const who = useDescribe().who;
  const [open, setOpen] = useState<Opened | null>(null);
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const draft = isDraftId(id);
  useEffect(() => {
    if (draft || !who) return;
    let dead = false, got = false;
    openLive(scope, id, { subject: who.subject, display: who.display }).then(
      (o) => { got = true; if (dead) void releaseLive(id); else setOpen(o); },
      () => { if (!dead) setFailed(true); },
    );
    return () => { dead = true; setOpen(null); setFailed(false); if (got) void releaseLive(id); };
    // the session is per page; who is the same for the life of the screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, draft, who?.subject]);
  useEffect(() => open?.live.subscribe((e) => { if (e === "reset") setGeneration((g) => g + 1); }), [open]);
  const state = useSyncExternalStore(
    (f) => open?.live.subscribe((e) => { if (e === "state") f(); }) ?? (() => undefined),
    () => open?.live.state ?? "synced",
    () => "synced" as LiveState,
  );
  return { open, failed, generation, state };
}

/** The other people on the page now: their names and colours, from Presence. */
export function usePresence(open: Opened | null): { name: string; color: string }[] {
  const snap = useSyncExternalStore(
    (f) => (open ? open.presence.subscribe(f) : () => undefined),
    () => (open ? JSON.stringify(Object.entries(open.presence.getAll()).filter(([peer, s]) => peer !== open.peer && s.user).map(([, s]) => s.user)) : "[]"),
    () => "[]",
  );
  return JSON.parse(snap) as { name: string; color: string }[];
}
