import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { link } from "../../api/link";
import { useRead } from "../../api/hooks";
import { askConfirm } from "../../ui/overlays";
import type { Project, Task } from "../../api/types";
import { useI18n, translate, type Key } from "../../i18n/i18n";
import { useDateFormat } from "../../lib/format";
import { Avatar } from "../../ui/Avatar";
import { Button, IconButton } from "../../ui/Button";
import { TextField } from "../../ui/Field";
import { Select } from "../../ui/Select";
import { Window } from "../dialogs/Dialog";

export type ProjectDialog = "members" | "settings" | "archived" | "history";

const refreshAll = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ predicate: (q) => /^(tasks|projects|audit)\./.test(String(q.queryKey[0])) });

/** Members: who is in the project and at what level; managers add and remove people. */
export function Members({ project, manager, onClose }: { project: Project; manager: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const members = useRead("projects.members", { project: project.id }).data.members;
  const [error, setError] = useState<string | null>(null);
  return (
    <Window title={t("members")} onClose={onClose}>
      <ul className="m-0 grid list-none gap-1 p-0">
        {members.map((m) => (
          <li key={m.subject} className="flex items-center gap-2.5 rounded-md px-2 py-1.5"><Avatar subject={m.subject} name={m.display ?? m.subject} /><span className="min-w-0 grow truncate" dir="auto">{m.display ?? m.subject}</span><span className="rounded-chip border border-line px-2 py-0.5 text-xs">{t(m.level as "editor")}{m.via === "space" ? " · " + t("viaSpace") : ""}</span>
            {manager && m.level !== "owner" && m.via === "project" && <IconButton icon="close" label={t("remove")} size="sm" tone="danger" onPress={async () => { await link.call("projects.unshare", { project: project.id, subject: m.subject }); await refreshAll(qc); }} />}</li>
        ))}
      </ul>
      {manager && (
        <form className="mt-3 flex gap-2" onSubmit={async (e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget), username = String(f.get("username") ?? "").trim(); if (!username) return;
          try { await link.call("projects.share", { project: project.id, username, level: String(f.get("level")) as "editor" }); e.currentTarget.reset(); setError(null); await refreshAll(qc); } catch (x) { setError(x instanceof Error ? x.message : t("offline")); }
        }}>
          <TextField name="username" dir="auto" placeholder={t("theirUsername")} label={t("theirUsername")} className="min-w-0 grow" />
          <Select name="level" label={t("accessLevel")} defaultValue="editor" options={[{ value: "editor", label: t("editor") }, { value: "viewer", label: t("viewer") }]} />
          <Button kind="primary" type="submit">{t("share")}</Button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
    </Window>
  );
}

type Col = { id: string; name: string };
type Attr = { key: string; label: string; type: "text" | "number" | "date" | "boolean" | "choice"; choices: string };

/** Columns (the last one means done) and custom fields of a project. */
export function Settings({ project, onClose }: { project: Project; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [cols, setCols] = useState<Col[]>(project.statuses.map((s) => ({ ...s })));
  const [attrs, setAttrs] = useState<Attr[]>((project.attributes ?? []).map((a) => ({ key: a.key, label: a.label, type: a.type as Attr["type"], choices: (a.choices ?? []).join(", ") })));
  const slug = (s: string) => (s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "col").slice(0, 30);
  const unique = (name: string) => { const base = slug(name); let id = base, n = 2; while (cols.some((c) => c.id === id)) id = base + "-" + n++; return id; };
  const move = (i: number, d: number) => setCols((c) => { const j = i + d; if (j < 0 || j >= c.length) return c; const n = [...c]; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  const save = async () => {
    await link.call("projects.update", { project: project.id, expected_rev: project.rev, statuses: cols.map((c) => ({ ...c, name: c.name.trim() || c.id })), attributes: attrs.filter((a) => a.key && a.label).map((a) => ({ key: a.key, label: a.label, type: a.type, ...(a.type === "choice" ? { choices: a.choices.split(",").map((x) => x.trim()).filter(Boolean) } : {}) })) } as never);
    await refreshAll(qc); onClose();
  };
  return (
    <Window title={t("projectSettings")} onClose={onClose} wide>
      <h3 className="mb-1 text-[13px] font-semibold uppercase text-muted">{t("columns")}</h3>
      <p className="mb-2 mt-0 text-muted">{t("doneNote")}</p>
      {cols.map((c, i) => (
        <div key={c.id} className="mb-1 flex items-center gap-1.5">
          <TextField value={c.name} maxLength={60} label={t("columnName")} onChange={(v) => setCols((all) => all.map((x, k) => (k === i ? { ...x, name: v } : x)))} className="min-w-0 grow" />
          {i === cols.length - 1 && <span className="rounded-chip border border-line px-2 py-0.5 text-xs">{t("doneN")}</span>}
          <IconButton icon="up" label={t("up")} size="sm" onPress={() => move(i, -1)} /><IconButton icon="down" label={t("down")} size="sm" onPress={() => move(i, 1)} />
          <IconButton icon="close" label={t("delete")} size="sm" tone="danger" isDisabled={cols.length <= 2} onPress={() => void askConfirm(t("sureColumn")).then((ok) => { if (ok) setCols((all) => all.filter((_, k) => k !== i)); })} />
        </div>
      ))}
      <form className="mb-4 mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const n = String(new FormData(e.currentTarget).get("name") ?? "").trim(); if (!n || cols.length >= 12) return; setCols((all) => [...all.slice(0, -1), { id: unique(n), name: n }, all[all.length - 1]!]); e.currentTarget.reset(); }}>
        <TextField name="name" maxLength={60} placeholder={t("columnName")} label={t("columnName")} className="min-w-0 grow" /><Button type="submit">{t("addColumn")}</Button>
      </form>
      <h3 className="mb-2 text-[13px] font-semibold uppercase text-muted">{t("attributes")}</h3>
      {attrs.map((a, i) => (
        <div key={i} className="mb-1 flex flex-wrap items-center gap-1.5">
          <TextField value={a.label} maxLength={60} placeholder={t("fieldLabel")} label={t("fieldLabel")} onChange={(v) => setAttrs((all) => all.map((x, k) => (k === i ? { ...x, label: v } : x)))} className="min-w-0 grow" />
          <TextField value={a.key} maxLength={30} placeholder={t("fieldKey")} label={t("fieldKey")} onChange={(v) => setAttrs((all) => all.map((x, k) => (k === i ? { ...x, key: v.toLowerCase().replace(/[^a-z0-9_]/g, "_") } : x)))} className="w-28" />
          <Select value={a.type} label={t("fieldType")} onChange={(v) => setAttrs((all) => all.map((x, k) => (k === i ? { ...x, type: v as Attr["type"] } : x)))} options={(["text", "number", "date", "boolean", "choice"] as const).map((ty) => ({ value: ty, label: t(("t_" + ty) as Key) }))} />
          {a.type === "choice" && <TextField value={a.choices} placeholder={t("fieldChoices")} label={t("fieldChoices")} onChange={(v) => setAttrs((all) => all.map((x, k) => (k === i ? { ...x, choices: v } : x)))} />}
          <IconButton icon="close" label={t("delete")} size="sm" tone="danger" onPress={() => setAttrs((all) => all.filter((_, k) => k !== i))} />
        </div>
      ))}
      <Button icon="plus" onPress={() => setAttrs((all) => [...all, { key: "", label: "", type: "text", choices: "" }])}>{t("addAttribute")}</Button>
      <div className="mt-4 flex justify-end gap-2"><Button onPress={onClose}>{t("cancel")}</Button><Button kind="primary" onPress={() => void save()}>{t("save")}</Button></div>
    </Window>
  );
}

/** Archived tasks of the project, to restore. */
export function Archived({ project, writer, onClose }: { project: Project; writer: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["tasks.list", { project: project.id, archived: true, limit: 200 }], queryFn: () => link.call("tasks.list", { project: project.id, archived: true, limit: 200 } as never) as Promise<{ tasks: Task[] }> });
  const tasks = data?.tasks ?? [];
  return (
    <Window title={t("archived")} onClose={onClose}>
      {tasks.length === 0 ? <p className="m-0 text-muted">{t("noArchived")}</p> : <ul className="m-0 grid list-none gap-1 p-0">{tasks.map((x) => (
        <li key={x.id} className="flex items-center gap-2 rounded-md px-2 py-1.5"><span className="min-w-0 grow truncate" dir="auto">{x.title}</span>{writer && <Button size="sm" onPress={async () => { await link.call("tasks.update", { project: project.id, id: x.id, archived: false }); await refreshAll(qc); }}>{t("restore")}</Button>}</li>
      ))}</ul>}
    </Window>
  );
}

interface Entry { id: string; kind: string; actor: string; at: number; data?: Record<string, unknown> }

/** What happened in the project (managers only): one sentence per entry, newest first. */
export function History({ project, onClose }: { project: Project; onClose: () => void }) {
  const { t, lang } = useI18n();
  const f = useDateFormat();
  const members = useRead("projects.members", { project: project.id }).data.members;
  const { data } = useQuery({ queryKey: ["audit.list", { project: project.id, limit: 50 }], queryFn: () => link.call("audit.list", { project: project.id, limit: 50 } as never) as Promise<{ entries: Entry[] }> });
  const who = (s: string) => members.find((m) => m.subject === s)?.display ?? s;
  const sentence = (e: Entry) => {
    const key = "h" + e.kind.charAt(0).toUpperCase() + e.kind.slice(1).replace(/\./g, "_");
    const d = e.data ?? {};
    const task = (d.task as { title?: string } | undefined)?.title ?? (d.title as string | undefined) ?? t("aTask"), name = String((d.name as string | undefined) ?? (d.project as string | undefined) ?? "");
    const s = translate(lang, key, { actor: who(e.actor), task, name });
    return s === key ? `${who(e.actor)} · ${e.kind}` : s;
  };
  return (
    <Window title={t("audit")} onClose={onClose} wide>
      <ul className="m-0 grid max-h-[60vh] list-none gap-1 overflow-auto p-0">
        {(data?.entries ?? []).map((e) => <li key={e.id} className="flex gap-3 rounded-md px-2 py-1.5"><span className="grow" dir="auto">{sentence(e)}</span><span className="shrink-0 text-xs text-muted">{f.time(e.at)}</span></li>)}
      </ul>
    </Window>
  );
}

/** Shows the one window the project screen asked for (loaded on demand, with the accessible-dialog library). */
export default function ProjectDialogHost({ which, project, manager, writer, onClose }: { which: ProjectDialog; project: Project; manager: boolean; writer: boolean; onClose: () => void }) {
  if (which === "members") return <Members project={project} manager={manager} onClose={onClose} />;
  if (which === "settings") return <Settings project={project} onClose={onClose} />;
  if (which === "archived") return <Archived project={project} writer={writer} onClose={onClose} />;
  return <History project={project} onClose={onClose} />;
}
