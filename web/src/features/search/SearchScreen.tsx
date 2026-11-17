import { useNavigate } from "@tanstack/react-router";
import { useDeferredValue } from "react";
import { spaceState, usePersistedValue } from "../../app/ui-state";
import { Topbar } from "../../app/regions";
import { useT } from "../../i18n/i18n";
import { Icon } from "../../ui/Icon";
import { SearchField } from "../../ui/Field";
import { TextLink } from "../../ui/Link";
import { Segmented } from "../../ui/Segmented";
import { ToggleChip } from "../../ui/Toggle";
import { hrefOfHit, searchHref, useSearch, type Hit } from "./useSearch";

export type SearchKind = "page" | "knowledge" | "task";
export interface SearchParams { q?: string; kind?: SearchKind; all?: "1" }

/**
 * Search as a page (ADR 0070): words, or `#tag` for the pages that carry a tag, over every kind of thing the Core can find. The address holds the
 * query, the kind and whether all Spaces are searched, so a result list can be linked to and survives a reload.
 */
export function SearchScreen({ q = "", kind, all }: SearchParams) {
  const t = useT();
  const navigate = useNavigate();
  const space = usePersistedValue(spaceState);
  const query = useDeferredValue(q.trim());
  const { data, isFetching } = useSearch(query, all === "1", space, 50);
  const items = (data?.items ?? []).filter((h) => !kind || h.kind === kind);
  const change = (patch: Partial<SearchParams>) => void navigate({ to: "/search", search: (prev: SearchParams) => ({ ...prev, ...patch }), replace: true });
  const title = t("search").replace("…", "");

  return (
    <>
      <Topbar title={title} crumbs={<span aria-current="page" className="px-1.5 font-semibold text-text">{title}</span>} />
      <div className="mx-auto grid max-w-[820px] gap-3 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField autoFocus label={t("search")} placeholder={t("search")} value={q} onChange={(v) => change({ q: v || undefined })} className="min-w-52 grow" dir="auto" />
          <ToggleChip isSelected={all === "1"} onChange={(on) => change({ all: on ? "1" : undefined })}>{t("searchEverywhere")}</ToggleChip>
        </div>
        <Segmented label={t("kindAll")} value={kind ?? ""} onChange={(v) => change({ kind: (v || undefined) as SearchKind | undefined })} className="justify-self-start"
          options={[{ value: "", label: t("kindAll") }, { value: "page", label: t("kindPages") }, { value: "knowledge", label: t("kindKnowledge") }, { value: "task", label: t("kindTasks") }]} />
        {query.length < 2 ? <p className="m-0 text-muted-foreground">{t("searchPageHint")}</p>
          : items.length === 0 && !isFetching ? <p className="m-0 grid justify-items-center gap-2 py-10 text-muted-foreground"><Icon name="search" className="size-6" /><b className="text-text">{t("noResults")}</b></p>
          : (
            <ul aria-label={t("resultsFor")} className="m-0 grid list-none gap-1 p-0">
              {items.map((h) => <Result key={h.kind + ":" + h.id} hit={h} />)}
            </ul>
          )}
      </div>
    </>
  );
}

function Result({ hit: h }: { hit: Hit }) {
  const t = useT();
  return (
    <li className="flex items-start gap-2.5 rounded-md px-2.5 py-2 hoverable">
      <Icon name={h.kind === "page" || h.kind === "knowledge" ? "page" : "task"} className="mt-0.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 grow">
        <TextLink href={hrefOfHit(h)} className="block truncate font-semibold"><span dir="auto">{h.title || t("untitled")}</span></TextLink>
        {h.snippet && <span className="block truncate text-[13px] text-muted-foreground" dir="auto">{h.snippet}</span>}
        {h.tags && h.tags.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{h.tags.map((tag) => <TextLink key={tag} href={searchHref("#" + tag)} className="rounded-chip bg-soft px-2 py-0.5 text-xs"><span dir="auto">#{tag}</span></TextLink>)}</span>}
      </span>
      {h.project_name && <span className="rounded-chip border border-line px-2 py-0.5 text-xs" dir="auto">{h.project_name}</span>}
    </li>
  );
}
