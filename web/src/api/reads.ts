import type { QueryClient } from "@tanstack/react-query";
import { link } from "./link";

/** One read: an operation and its input. The same pairs are what components read, so a warmed read is a cache hit. */
export type Read = [op: string, input: object];

/** What each screen shows, by name. The router's loaders and the first request at page load both use these, so a screen's reads start together. */
export const reads = {
  today: (space: string): Read[] => [["tasks.my", {}], ["tasks.focus", {}], ["pages.tasks", { space, limit: 40 }]],
  pages: (space: string): Read[] => [["pages.list", { space }]],
  page: (space: string, id: string): Read[] => [...reads.pages(space), ["pages.get", { id }]],
  project: (id: string): Read[] => [["projects.get", { project: id }], ["projects.members", { project: id }], ["tasks.list", { project: id, limit: 500 }], ["tasks.labels.list", { project: id }], ["tasks.focus", {}]],
};

export function warm(qc: QueryClient, list: Read[]): Promise<unknown> {
  return Promise.all(list.map(([op, input]) => qc.prefetchQuery({ queryKey: [op, input], queryFn: () => link.call(op as never, input as never) })));
}

/** The reads of the screen the address names (`#/today`, `#/pages/<id>`, `#/p/<project>`), so they start before the router does. */
export function readsForHash(hash: string, space: string): Read[] {
  const h = hash.replace(/^#/, "");
  if (h === "" || h === "/" || h.startsWith("/today")) return reads.today(space);
  const page = /^\/pages\/([^/?]+)/.exec(h);
  if (page) return page[1] === "new" ? reads.pages(space) : reads.page(space, decodeURIComponent(page[1]!));
  if (h.startsWith("/pages")) return reads.pages(space);
  const project = /^\/p\/([^/?]+)/.exec(h);
  return project ? reads.project(decodeURIComponent(project[1]!)) : [];
}
