import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { link } from "../../api/link";
import type { Project } from "../../api/types";
import { useT } from "../../i18n/i18n";
import { useDateFormat } from "../../lib/format";
import { DueChip, PriorityChip } from "../tasks/TaskRow";
import { Button, IconButton } from "../../ui/Button";
import { SearchField } from "../../ui/Field";
import { Select } from "../../ui/Select";
import { DataTable } from "../../ui/Table";
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
  const columns = [{ id: "title", label: t("title"), isRowHeader: true }, { id: "status", label: t("status") }, { id: "priority", label: t("priority") }, { id: "due", label: t("due") }, { id: "assignee", label: t("assignee") }, ...attrs.map((a) => ({ id: "custom." + a.key, label: a.label }))];
  const cell = (r: Row, c: string) => {
    if (c === "title") return <span dir="auto">{r.parent && <Icon name="subtask" className="me-1 inline size-3.5" />}{r.title}</span>;
    if (c === "status") return <span className="rounded-chip border border-line px-2 py-0.5 text-xs">{project.statuses.find((s) => s.id === r.status)?.name ?? r.status}</span>;
    if (c === "priority") return <PriorityChip band={r.band} />;
    if (c === "due") return <DueChip due={r.due} today={today} done={!!r.completed_at} />;
    if (c === "assignee") return name(r.assignee);
    const a = attrs.find((x) => "custom." + x.key === c), v = a && r.custom?.[a.key];
    return !a || v === undefined || v === null ? "" : a.type === "boolean" ? (v ? t("yes") : t("no")) : a.type === "date" ? f.date(String(v)) : String(v);
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchField value={q} onChange={setQ} placeholder={t("search")} label={t("search")} dir="auto" />
        <Select label={t("status")} value={status} onChange={setStatus} options={[{ value: "", label: t("all") + " · " + t("status") }, ...project.statuses.map((s) => ({ value: s.id, label: s.name }))]} />
        <Select label={t("assignee")} value={assignee} onChange={setAssignee} options={[{ value: "", label: t("all") + " · " + t("assignee") }, { value: "-", label: t("nobody") }, ...members.map((m) => ({ value: m.subject, label: m.display ?? m.subject }))]} />
        <Select label={t("sortBy")} value={sort} onChange={setSort} options={sorts.map(([v, l]) => ({ value: v, label: t("sortBy") + ": " + l }))} />
        <IconButton icon={desc ? "down" : "up"} label={desc ? t("descending") : t("ascending")} onPress={() => setDesc(!desc)} />
        <span className="text-muted-foreground">{t("total")}: {data?.total ?? rows.length}</span>
      </div>
      <div className="overflow-auto rounded-md border border-line">
        <DataTable label={t("tasksTab")} columns={columns} rows={rows} cell={cell} onOpen={onOpen} empty={<><Icon name="search" className="mx-auto mb-1 size-6" /><b>{t("none")}</b></>} />
      </div>
      {data?.next ? <div className="mt-3"><Button onPress={() => setLimit(limit + 100)}>{t("loadOlder")}</Button></div> : null}
    </div>
  );
}
