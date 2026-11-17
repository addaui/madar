import type { QueryClient } from "@tanstack/react-query";
import { link } from "../../api/link";
import type { Page } from "../../api/types";
import { PageSaver, registerSaver, saverFor, type PagePatch } from "./pageSaver";
import { inputOf, keyOf, opOf, type PageScope } from "./scope";

/**
 * "New page" makes nothing on the server. The page is a draft in the browser, with the same side panel, style and options as a stored page, and it
 * is stored the moment the person puts something in it: a title, text, a block or a sticker. Changing its style, icon or tags alone does not store it,
 * so a page nobody wrote in never exists, and leaving, refreshing or closing the tab needs no clean-up.
 */
export const isDraftId = (id: string) => id.startsWith("draft-");

/** Whether a document has nothing in it: only empty paragraphs (a block of any other kind, a text, or anything else on the document counts as content). */
export function isBlank(n: unknown): boolean {
  if (n === null || n === undefined) return true;
  const o = n as { type?: string; content?: unknown[]; text?: string } & Record<string, unknown>;
  if (o.type === "text") return !(o.text ?? "").trim();
  if (o.type !== "doc" && o.type !== "paragraph") return false;
  if (Object.keys(o).some((k) => !["type", "content", "attrs", "marks"].includes(k))) return false;
  return (o.content ?? []).every(isBlank);
}

/** What counts as the person's own content: a title, or anything in the body. */
export const hasContent = (p: { title: string; body: unknown }): boolean => p.title.trim() !== "" || !isBlank(p.body);

let counter = 0;

/** One draft: what is on screen, and the move to the server when there is content. */
export class DraftSession {
  readonly id = `draft-${++counter}`;
  readonly key = this.id;
  page: Page;
  createdId: string | null = null;
  /** Set when the person has gone elsewhere: a late store (typing just before leaving) must not pull them back. */
  detached = false;
  detach() { this.detached = true; }
  #creating: Promise<Page> | null = null;
  #listeners = new Set<() => void>();
  readonly saver: DraftSaver;

  #onCreated: (id: string) => void = () => undefined;
  /** What to do once the draft is stored (the Face moves to the stored page's address). */
  onStored(f: (id: string) => void) { this.#onCreated = f; }

  constructor(private readonly qc: QueryClient, readonly scope: PageScope, private readonly parent: string | undefined, who: string) {
    const now = Date.now();
    this.page = { id: this.id, rev: 0, title: "", body: { type: "doc", content: [{ type: "paragraph" }] }, icon: null, tags: [], settings: {}, created_by: who, created_at: now, updated_at: now } as unknown as Page;
    this.saver = new DraftSaver(this, qc);
    registerSaver(this.saver);
  }

  subscribe = (l: () => void) => { this.#listeners.add(l); return () => { this.#listeners.delete(l); }; };
  getPage = () => this.page;
  #tell() { this.#listeners.forEach((l) => l()); }

  /** Apply a change to the draft; store it if it now has content. */
  change(patch: PagePatch): Promise<unknown> {
    if (this.createdId) return this.#real().save(patch);
    this.page = { ...this.page, ...patch } as Page;
    this.#tell();
    if (this.#creating) return this.#creating.then(() => this.#real().save(patch));
    return hasContent(this.page) ? this.#create().then(() => undefined) : Promise.resolve();
  }

  /** Store the draft now, whatever it holds (a page that something must hang from, such as a subpage). */
  async store(): Promise<string> {
    if (this.createdId) return this.createdId;
    return (await (this.#creating ?? this.#create())).id;
  }

  #real = () => saverFor(this.qc, this.qc.getQueryData<Page>(keyOf(this.scope, "get", { id: this.createdId! })) ?? this.page, this.scope);

  #create(): Promise<Page> {
    const d = this.page, scope = this.scope;
    this.#creating = (async () => {
      let out = (await link.call(opOf(scope, "create") as never, inputOf(scope, { title: d.title.trim(), body: d.body, parent: this.parent ?? null, icon: d.icon ?? null, ...(scope.project ? {} : { space: scope.space }) }) as never)) as Page;
      const rest: PagePatch = {};
      if (Object.keys(d.settings ?? {}).length) rest.settings = d.settings as never;
      if ((d.tags ?? []).length) rest.tags = d.tags as string[];
      if (Object.keys(rest).length) out = (await link.call(opOf(scope, "update") as never, inputOf(scope, { id: out.id, expected_rev: out.rev, ...rest }) as never)) as Page;
      this.qc.setQueryData(keyOf(scope, "get", { id: out.id }), out);
      this.createdId = out.id;
      await this.qc.invalidateQueries({ predicate: (q) => /^(pages|knowledge)\.list/.test(String(q.queryKey[0])) });
      if (!this.detached) this.#onCreated(out.id);
      this.#tell();
      return out;
    })();
    return this.#creating;
  }
}

/** The saver every part of the page uses while it is a draft. It has the same surface as a stored page's saver. */
class DraftSaver extends PageSaver {
  constructor(private readonly session: DraftSession, qc: QueryClient) { super(session.id, 0, qc, session.scope); }
  override save(patch: PagePatch): Promise<unknown> { return this.session.change(patch); }
  override ensureStored(): Promise<string> { return this.session.store(); }
}
