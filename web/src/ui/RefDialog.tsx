import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { link } from "../api/link";
import { useT } from "../i18n/i18n";
import { Icon } from "./Icon";
import { ModalFrame, ModalTitle } from "./Modal";
import { SearchList } from "./SearchList";

interface Hit { kind: string; id: string; title: string; project_name?: string | null }

/** Choose a page or a task to link to from a document (the editor's "link to a page or task"). */
export function RefDialog({ onDone }: { onDone: (v: { kind: string; id: string; title: string } | null) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const { data } = useQuery({ queryKey: ["search.query", { q: query, ref: true }], queryFn: () => link.call("search.query", { q: query } as never) as Promise<{ items: Hit[] }>, enabled: query.length >= 2 });
  const items = data?.items ?? [];
  const pick = (h: Hit) => onDone({ kind: h.kind === "task" ? "tasks.task" : "pages.page", id: h.id, title: h.title });
  return (
    <ModalFrame label={t("pickItem")} onClose={() => onDone(null)} size="lg">
      <ModalTitle className="mb-3">{t("pickItem")}</ModalTitle>
      <SearchList label={t("searchItems")} placeholder={t("searchItems")} value={q} onChange={setQ} items={items.map((h) => ({ id: h.kind + ":" + h.id, text: h.title || t("untitled"), hit: h }))} onPick={(it) => pick(it.hit)}
        empty={query.length < 2 ? t("searchHint") : t("noResults")} listClassName="max-h-[40vh]"
        render={({ hit: h }) => (<><Icon name={h.kind === "task" ? "task" : "page"} className="text-muted" /><span className="truncate" dir="auto">{h.title || t("untitled")}</span></>)} />
    </ModalFrame>
  );
}
