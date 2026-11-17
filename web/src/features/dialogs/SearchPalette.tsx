import { useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useState } from "react";
import { useI18n } from "../../i18n/i18n";
import { spaceState, usePersistedValue } from "../../app/ui-state";
import { Icon } from "../../ui/Icon";
import { SearchList } from "../../ui/SearchList";
import { ToggleChip } from "../../ui/Toggle";
import { searchHref, useSearch, type Hit } from "../search/useSearch";
import { TextLink } from "../../ui/Link";
import { Window } from "./Dialog";

/** Find anything by words: pages, project knowledge and tasks. Arrow keys move, Enter opens. Limited to the current Space unless asked. */
export function SearchPalette({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const space = usePersistedValue(spaceState);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const query = useDeferredValue(q.trim());
  const items = useSearch(query, all, space, 20).data?.items ?? [];

  const open = (h: Hit) => {
    onClose();
    if (h.kind === "page") void navigate({ to: "/pages/$pageId", params: { pageId: h.id } });
    else if (h.kind === "knowledge" && h.project) void navigate({ to: "/p/$projectId", params: { projectId: h.project }, search: { tab: "knowledge", page: h.id } });
    else if (h.project) void navigate({ to: "/p/$projectId", params: { projectId: h.project }, search: { task: h.id } });
  };

  return (
    <Window title={t("search").replace("…", "")} onClose={onClose} wide>
      <SearchList label={t("search")} placeholder={t("search")} value={q} onChange={setQ} items={items.map((h) => ({ id: h.kind + ":" + h.id, text: h.title || t("untitled"), hit: h }))} onPick={(it) => open(it.hit)}
        extra={<ToggleChip isSelected={all} onChange={setAll}>{t("searchEverywhere")}</ToggleChip>}
        empty={query.length < 2 ? t("searchHint") : <span className="grid justify-items-center gap-2 py-4"><Icon name="search" /><b className="text-text">{t("noResults")}</b></span>}
        render={({ hit: h }) => (
          <>
            <Icon name={h.kind === "page" || h.kind === "knowledge" ? "page" : "task"} className="mt-0.5 text-muted-foreground" />
            <span className="min-w-0 grow"><b className="block truncate" dir="auto">{h.title || t("untitled")}</b>{h.snippet && <span className="block truncate text-[13px] text-muted-foreground" dir="auto">{h.snippet}</span>}</span>
            {h.project_name && <span className="rounded-chip border border-line px-2 py-0.5 text-xs" dir="auto">{h.project_name}</span>}
          </>
        )} />
      {query.length >= 2 && <div className="mt-2"><TextLink href={searchHref(query)} onPress={onClose} className="inline-block px-1 py-0.5 text-[13px] text-brand">{t("showAllResults")}</TextLink></div>}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2.5 text-xs text-muted-foreground">
        <span><kbd className="rounded border border-line px-1">↑</kbd> <kbd className="rounded border border-line px-1">↓</kbd> {t("kMove")}</span>
        <span><kbd className="rounded border border-line px-1">↵</kbd> {t("kOpen")}</span>
        <span><kbd className="rounded border border-line px-1">Esc</kbd> {t("close")}</span>
      </div>
    </Window>
  );
}
