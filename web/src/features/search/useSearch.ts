import { useQuery } from "@tanstack/react-query";
import { link } from "../../api/link";

export interface Hit { kind: string; id: string; title: string; snippet?: string; project?: string | null; project_name?: string | null; space?: string | null; tags?: string[] }

/** The address of what a search hit is (the Face routes by the hash). */
export const hrefOfHit = (h: Hit): string =>
  h.kind === "page" ? `#/pages/${h.id}` : h.kind === "knowledge" && h.project ? `#/p/${h.project}?tab=knowledge&page=${h.id}` : h.project ? `#/p/${h.project}?task=${h.id}` : "#/today";

/** Search for words, or `#tag`, in one Space or in all of them. One reader for the pop-up and the Search screen. */
export function useSearch(query: string, everywhere: boolean, space: string, limit?: number) {
  return useQuery({
    queryKey: ["search.query", { q: query, space: everywhere ? null : space, limit: limit ?? null }],
    queryFn: () => link.call("search.query", { q: query, ...(everywhere ? {} : { space }), ...(limit ? { limit } : {}) } as never) as Promise<{ items: Hit[] }>,
    enabled: query.length >= 2,
  });
}

/** The address of a search, so a list of results can be linked to. */
export const searchHref = (q: string) => "#/search?q=" + encodeURIComponent(q);
