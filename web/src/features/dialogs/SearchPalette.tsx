import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useState } from "react";
import { link } from "../../api/link";
import { useI18n } from "../../i18n/i18n";
import { cn } from "../../lib/cn";
import { spaceState, usePersistedValue } from "../../app/ui-state";
import { Icon } from "../../ui/Icon";
import { Window } from "./Dialog";

interface Hit { kind: string; id: string; title: string; snippet?: string; project?: string | null; project_name?: string | null; space?: string | null }

/** Find anything by words: pages, project knowledge and tasks. Arrow keys move, Enter opens. Limited to the current Space unless asked. */
export function SearchPalette({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const space = usePersistedValue(spaceState);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [cursor, setCursor] = useState(0);
  const query = useDeferredValue(q.trim());
  const { data } = useQuery({
    queryKey: ["search.query", { q: query, space: all ? null : space }],
    queryFn: () => link.call("search.query", { q: query, ...(all ? {} : { space }) } as never) as Promise<{ items: Hit[] }>,
    enabled: query.length >= 2,
  });
  const items = data?.items ?? [];

  const open = (h: Hit) => {
    onClose();
    if (h.kind === "page") void navigate({ to: "/pages/$pageId", params: { pageId: h.id } });
    else if (h.kind === "knowledge" && h.project) void navigate({ to: "/p/$projectId", params: { projectId: h.project }, search: { tab: "knowledge", page: h.id } });
    else if (h.project) void navigate({ to: "/p/$projectId", params: { projectId: h.project }, search: { task: h.id } });
  };

  return (
    <Window title={t("search").replace("…", "")} onClose={onClose} wide>
      <div className="flex items-center gap-2">
        <input autoFocus type="search" value={q} onChange={(e) => { setQ(e.target.value); setCursor(0); }} placeholder={t("search")} aria-label={t("search")} dir="auto" className="field grow"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(items.length - 1, c + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
            else if (e.key === "Enter" && items[cursor]) { e.preventDefault(); open(items[cursor]!); }
          }} />
        <button type="button" aria-pressed={all} onClick={() => setAll(!all)} className={cn("rounded-chip border border-line px-3 py-1.5 text-[13px] text-muted aria-pressed:border-accent aria-pressed:text-text")}>{t("searchEverywhere")}</button>
      </div>
      <ul role="listbox" className="m-0 mt-3 grid max-h-[50vh] list-none gap-0.5 overflow-auto p-0">
        {items.map((h, i) => (
          <li key={h.kind + h.id} role="option" aria-selected={i === cursor} onMouseMove={() => setCursor(i)} onClick={() => open(h)}
            className="flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 aria-selected:bg-hover">
            <Icon name={h.kind === "page" || h.kind === "knowledge" ? "page" : "task"} className="mt-0.5 text-muted" />
            <span className="min-w-0 grow"><b className="block truncate" dir="auto">{h.title || t("untitled")}</b>{h.snippet && <span className="block truncate text-[13px] text-muted" dir="auto">{h.snippet}</span>}</span>
            {h.project_name && <span className="rounded-chip border border-line px-2 py-0.5 text-xs" dir="auto">{h.project_name}</span>}
          </li>
        ))}
        {query.length < 2 && <li className="px-3 py-3.5 text-muted">{t("searchHint")}</li>}
        {query.length >= 2 && items.length === 0 && <li className="grid justify-items-center gap-2 px-2.5 py-8 text-muted"><Icon name="search" /><b className="text-text">{t("noResults")}</b></li>}
      </ul>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2.5 text-xs text-muted">
        <span><kbd className="rounded border border-line px-1">↑</kbd> <kbd className="rounded border border-line px-1">↓</kbd> {t("kMove")}</span>
        <span><kbd className="rounded border border-line px-1">↵</kbd> {t("kOpen")}</span>
        <span><kbd className="rounded border border-line px-1">Esc</kbd> {t("close")}</span>
      </div>
    </Window>
  );
}
