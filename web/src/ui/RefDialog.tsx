import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { link } from "../api/link";
import { useT } from "../i18n/i18n";
import { Icon } from "./Icon";

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
    <ModalOverlay isOpen isDismissable onOpenChange={(o) => { if (!o) onDone(null); }} className="fixed inset-0 z-[60] grid place-items-start justify-center bg-black/40 pt-[10vh] backdrop-blur-[3px]">
      <Modal className="w-[min(520px,94vw)] rounded-lg bg-surface p-5 shadow-2">
        <Dialog aria-label={t("pickItem")} className="outline-none">
          <Heading slot="title" className="m-0 mb-3 text-lg font-semibold">{t("pickItem")}</Heading>
          <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} dir="auto" className="field w-full"
            onKeyDown={(e) => { if (e.key === "Enter" && items[0]) { e.preventDefault(); pick(items[0]); } }} />
          <ul className="m-0 mt-2 grid max-h-[40vh] list-none gap-0.5 overflow-auto p-0">
            {items.map((h) => <li key={h.kind + h.id}><button type="button" onClick={() => pick(h)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start hover:bg-hover"><Icon name={h.kind === "task" ? "task" : "page"} className="text-muted" /><span className="min-w-0 grow truncate" dir="auto">{h.title}</span>{h.project_name && <span className="text-xs text-muted">{h.project_name}</span>}</button></li>)}
          </ul>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
