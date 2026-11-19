import type { QueryClient } from "@tanstack/react-query";
import { NuahError } from "@nuah/link-client";
import { useSyncExternalStore } from "react";
import { link } from "../../api/link";
import type { Page } from "../../api/types";
import type { EditorJson } from "./PageEditor";
import { inputOf, keyOf, opOf, type PageScope } from "./scope";
import type { PageSettings } from "./style/settings";

export type SaveState = "idle" | "saving" | "saved" | "offline";
export type PagePatch = { title?: string; body?: EditorJson; icon?: string | null; settings?: PageSettings; tags?: string[] };

/**
 * The one place a page's changes are sent from, whoever makes them (the editor, the title, the side panel). Changes go one after another,
 * each with `expected_rev`, so two quick changes never race on the same revision. A conflict means someone else changed the page:
 * the fresh copy is put in the cache and `onConflict` listeners are told.
 */
export class PageSaver {
  rev: number;
  #queue: Promise<unknown> = Promise.resolve();
  #pending = 0;
  #state: SaveState = "idle";
  #listeners = new Set<() => void>();
  readonly conflicts = new Set<(fresh: Page) => void>();

  constructor(readonly id: string, rev: number, private readonly qc: QueryClient, readonly scope: PageScope) { this.rev = rev; }

  subscribe = (l: () => void) => { this.#listeners.add(l); return () => { this.#listeners.delete(l); }; };
  getState = (): SaveState => this.#state;
  get busy() { return this.#pending > 0; }
  #set(s: SaveState) { this.#state = s; this.#listeners.forEach((l) => l()); }

  /** The id the page is stored under: its own, or (for a draft that has no content yet) the one it gets when stored now. */
  ensureStored(): Promise<string> { return Promise.resolve(this.id); }

  save(patch: PagePatch): Promise<unknown> {
    this.#pending++;
    this.#queue = this.#queue.then(() => this.#send(patch)).finally(() => { this.#pending--; });
    return this.#queue;
  }

  async #send(patch: PagePatch) {
    this.#set("saving");
    try {
      // Only a whole body is guarded by the revision: the body is a Live document now (ADR 0093), and every push moves the revision, so a title or an
      // icon would otherwise be refused while someone types.
      const guard = patch.body !== undefined ? { expected_rev: this.rev } : {};
      const out = (await link.call(opOf(this.scope, "update") as never, inputOf(this.scope, { id: this.id, ...guard, ...patch }) as never)) as Page;
      this.rev = out.rev;
      this.qc.setQueryData(keyOf(this.scope, "get", { id: this.id }), out);
      if (patch.title !== undefined || patch.icon !== undefined || patch.tags !== undefined) void this.qc.invalidateQueries({ predicate: (q) => /^(pages|knowledge)\.list/.test(String(q.queryKey[0])) });
      this.#set("saved");
    } catch (e) {
      if (e instanceof NuahError && e.category === "conflict") {
        const fresh = (await link.call(opOf(this.scope, "get") as never, inputOf(this.scope, { id: this.id }) as never)) as Page;
        this.rev = fresh.rev;
        this.qc.setQueryData(keyOf(this.scope, "get", { id: this.id }), fresh);
        this.conflicts.forEach((f) => f(fresh));
        this.#set("idle");
      } else this.#set("offline");
    }
  }
}

const savers = new Map<string, PageSaver>();   // by page id (ids are unique across scopes)

/** The saver of a page, made on first use. A copy that arrived from outside with a newer revision, while nothing is being saved, is adopted. */
export function saverFor(qc: QueryClient, page: Page, scope: PageScope): PageSaver {
  let s = savers.get(page.id);
  if (!s) { s = new PageSaver(page.id, page.rev, qc, scope); savers.set(page.id, s); }
  else if (!s.busy && page.rev > s.rev) s.rev = page.rev;
  return s;
}

/** Make `saver` the one that `saverFor` finds for this page id (a draft page has its own until it is stored). */
export function registerSaver(s: PageSaver) { savers.set(s.id, s); }

export function useSaveState(s: PageSaver): SaveState {
  return useSyncExternalStore(s.subscribe, s.getState, () => "idle");
}
