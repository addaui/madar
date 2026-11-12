import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { link } from "../../api/link";
import type { Project } from "../../api/types";
import { useT } from "../../i18n/i18n";
import { useDateFormat } from "../../lib/format";
import { DueChip, PriorityChip } from "../tasks/TaskRow";
import { IconButton } from "../../ui/Button";
import { Icon } from "../../ui/Icon";

interface Row { id: string; title: string; parent?: string | null; status: string; band?: string; due?: string | null; assignee?: string | null; custom?: Record<string, unknown>; completed_at?: number | null }

/** The table of a project's tasks: search, filter by column and assignee, sort, and paging. */
export function ListTab({ project, members, today, onOpen }: { project: Project; members: { subject: string; display?: string | null }[]; today: string; onOpen: (id: string) => void }) {
  const t = useT();
  const f = useDateFormat();
  const attrs = project.attributes ?? [];
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [assignee, setAssignee] = useState("");
  const [sort, setSort] = useState("position");
  const [desc, setDesc] = useState(false);
  const [limit, setLimit] = useState(100);
  const input = { project: project.id, sort, desc, limit, ...(q ? { q } : {}), ...(status ? { status } : {}), ...(assignee ? { assignee: assignee === "-" ? null : assignee } : {}) };
  const { data } = useQuery({ queryKey: ["tasks.query", input], queryFn: () => link.call("tasks.query", input as never) as Promise<{ tasks: Row[]; total?: number; next?: number | null }>, placeholderData: (prev) => prev });
  const rows = data?.tasks ?? [];
  const name = (id: string | null | undefined) => members.find((m) => m.subject === id)?.display ?? id ?? "";
  const sorts: [string, string][] = [["position", t("board")], ["title", t("title")], ["priority", t("priority")], ["due", t("due")], ["created_at", "↧"], ["status", t("status")], ...attrs.map((a): [string, string] => ["custom." + a.key, a.label])];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} dir="auto" className="field" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("status")} className="field"><option value="">{t("all")} · {t("status")}</option>{project.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label={t("assignee")} className="field"><option value="">{t("all")} · {t("assignee")}</option><option value="-">{t("nobody")}</option>{members.map((m) => <option key={m.subject} value={m.subject}>{m.display ?? m.subject}</option>)}</select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("sortBy")} className="field">{sorts.map(([v, l]) => <option key={v} value={v}>{t("sortBy")}: {l}</option>)}</select>
        <IconButton icon={desc ? "down" : "up"} label={desc ? t("descending") : t("ascending")} onClick={() => setDesc(!desc)} />
        <span className="text-muted">{t("total")}: {data?.total ?? rows.length}</span>
      </div>
      <div className="overflow-auto rounded-md border border-line">
        <table className="w-full border-collapse text-start">
          <thead className="bg-sunken text-start text-xs text-muted">
            <tr>{[t("title"), t("status"), t("priority"), t("due"), t("assignee"), ...attrs.map((a) => a.label)].map((h, i) => <th key={i} className="px-3 py-2 text-start font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} tabIndex={0} onClick={() => onOpen(r.id)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(r.id); }} className="cursor-pointer border-t border-line hoverable">
                <td className="px-3 py-2" dir="auto">{r.parent && <Icon name="subtask" className="me-1 inline size-3.5" />}{r.title}</td>
                <td className="px-3 py-2"><span className="rounded-chip border border-line px-2 py-0.5 text-xs">{project.statuses.find((s) => s.id === r.status)?.name ?? r.status}</span></td>
                <td className="px-3 py-2"><PriorityChip band={r.band} /></td>
                <td className="px-3 py-2"><DueChip due={r.due} today={today} done={!!r.completed_at} /></td>
                <td className="px-3 py-2">{name(r.assignee)}</td>
                {attrs.map((a) => { const v = r.custom?.[a.key]; return <td key={a.key} className="px-3 py-2">{v === undefined || v === null ? "" : a.type === "boolean" ? (v ? t("yes") : t("no")) : a.type === "date" ? f.date(String(v)) : String(v)}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="grid place-items-center gap-1 py-10 text-muted"><Icon name="search" className="size-6" /><b>{t("none")}</b></div>}
      </div>
      {data?.next ? <div className="mt-3"><button type="button" className="rounded-btn border border-line-strong px-3.5 py-1.5" onClick={() => setLimit(limit + 100)}>{t("loadOlder")}</button></div> : null}
    </div>
  );
}
