import { useQueryClient } from "@tanstack/react-query";
import { NuahError } from "@nuah/link-client";
import { startTransition, Suspense, useActionState, useRef, useState } from "react";
import { SkeletonLines } from "../../ui/Skeleton";
import { link } from "../../api/link";
import { usePrefs } from "../../api/session";
import type { Project, Task } from "../../api/types";
import { useI18n } from "../../i18n/i18n";
import { cn } from "../../lib/cn";
import { codeOf } from "../../lib/codes";
import { CopyCode } from "../../ui/CopyCode";
import { Button, IconButton } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { askConfirm, openContextMenu } from "../../ui/overlays";
import { LegacyEditor, type EditorJson } from "../pages/LegacyEditor";
import { Activity } from "./Activity";

const BANDS: [band: string, value: number][] = [["low", 2], ["medium", 5], ["high", 7], ["urgent", 9]];
const bandOf = (n: number) => (n >= 9 ? "urgent" : n >= 7 ? "high" : n >= 4 ? "medium" : "low");

type Member = { subject: string; display?: string | null };
type Label = { id: string; name: string };

/** One task, shown beside the board or list. The fields are a form: changing any shows the save bar; saving is an Action. */
export function TaskDrawer({ project, task, members, labels, subtasks, writer, onClose }: {
  project: Project; task: Task; members: Member[]; labels: Label[]; subtasks: Task[]; writer: boolean; onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const prefs = usePrefs();
  const [tab, setTab] = useState<"d" | "a">("d");
  const [dirty, setDirty] = useState(false);
  const [priority, setPriority] = useState(task.priority);
  const description = useRef<EditorJson | null>(null);
  const blocks = qc.getQueryData<{ blocks: unknown[] }>(["editor.blocks", {}])?.blocks ?? [];
  const custom0 = (task.custom ?? {}) as Record<string, unknown>;
  const refresh = () => qc.invalidateQueries({ predicate: (q) => /^(tasks|projects|timeline|discussion)\./.test(String(q.queryKey[0])) });

  const [error, save, pending] = useActionState(async (_prev: string | null, form: FormData): Promise<string | null> => {
    const input: Record<string, unknown> = {
      project: project.id, id: task.id, expected_rev: task.rev, title: String(form.get("title") ?? ""), status: String(form.get("status") ?? task.status), priority,
      due: String(form.get("due") ?? "") || null, assignee: String(form.get("assignee") ?? "") || null, labels: form.getAll("label").map(String),
    };
    if (description.current) input.description = description.current;
    const unit = String(form.get("repeat_unit") ?? "");
    const repeat = unit ? { every: Math.max(1, Math.min(365, Number(form.get("repeat_every")) || 1)), unit } : null;
    if (JSON.stringify(repeat) !== JSON.stringify(task.repeat ?? null)) input.repeat = repeat;
    const custom: Record<string, unknown> = {};
    for (const a of project.attributes ?? []) {
      const raw = form.get("custom." + a.key); const old = custom0[a.key] ?? null;
      const v = a.type === "boolean" ? form.get("custom." + a.key) === "on" : a.type === "number" ? (raw === "" || raw === null ? null : Number(raw)) : raw === "" || raw === null ? null : String(raw);
      if (v !== old && !(v === false && old === null)) custom[a.key] = v;
    }
    if (Object.keys(custom).length) input.custom = custom;
    try {
      await link.call("tasks.update", input as never);
      setDirty(false);
      await refresh();
      return null;
    } catch (e) {
      if (e instanceof NuahError && e.category === "conflict") { await refresh(); setDirty(false); return t("changed"); }
      if (!(e instanceof NuahError)) console.error(e);
      return e instanceof NuahError ? e.message : t("offline");
    }
  }, null);

  const archive = () => startTransition(async () => { await link.call("tasks.update", { project: project.id, id: task.id, archived: !task.archived }); await refresh(); onClose(); });
  const remove = async () => { if (!(await askConfirm(t("sure")))) return; await link.call("tasks.remove", { project: project.id, id: task.id }); await refresh(); onClose(); };
  const addSub = (title: string) => startTransition(async () => { await link.call("tasks.create", { project: project.id, title, parent: task.id, priority: prefs["tasks.default_priority"] ?? 0 } as never); await refresh(); });
  const toggleSub = (s: Task) => startTransition(async () => {
    const st = project.statuses;
    await link.call("tasks.move", { project: project.id, id: s.id, status: s.completed_at ? st[0]!.id : st[st.length - 1]!.id, after: null });
    await refresh();
  });
  const done = subtasks.filter((s) => s.completed_at).length;
  const code = codeOf(project.key, task.number);

  return (
    <aside role="dialog" aria-label={task.title} className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface workspace:rounded-none workspace:border-0 workspace:bg-transparent">
      <form action={save} onInput={() => setDirty(true)} onChange={() => setDirty(true)} className="flex min-h-0 flex-1 flex-col" key={task.rev}>
        <div className="flex items-center gap-1.5 border-b border-line px-3 py-2.5">
          <input name="title" defaultValue={task.title} disabled={!writer} maxLength={200} aria-label={t("title")} dir="auto" className="min-w-0 flex-1 border-0 bg-transparent text-lg font-semibold outline-none" />
          {writer && <IconButton icon="more" label={t("more")} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openContextMenu(r.left, r.bottom, [{ label: task.archived ? t("restore") : t("archive"), icon: "archive", onclick: archive }, "-", { label: t("delete"), icon: "trash", danger: true, onclick: () => void remove() }]); }} />}
          <IconButton icon="close" label={t("close") + " (Esc)"} onClick={onClose} />
        </div>
        <div role="tablist" className="flex gap-0.5 border-b border-line px-3">
          {(["d", "a"] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("border-b-2 border-transparent px-2.5 py-2 text-[13px] text-muted", tab === k && "border-accent font-semibold text-text")}>{t(k === "d" ? "tabDetails" : "activityTab")}</button>)}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div hidden={tab !== "d"}>
            {code && <div className="mb-2"><CopyCode code={code} /></div>}
            <div className="grid gap-2.5">
              <Prop icon="task" label={t("status")}><select name="status" defaultValue={task.status} disabled={!writer} aria-label={t("status")} className="field">{project.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Prop>
              <Prop icon="flag" label={t("priority")}>
                <div role="radiogroup" aria-label={t("priority")} className="inline-flex gap-0.5 rounded-[10px] bg-sunken p-0.5">
                  {BANDS.map(([band, v]) => <button key={band} type="button" role="radio" aria-checked={bandOf(priority) === band} disabled={!writer} onClick={() => { if (bandOf(priority) !== band) { setPriority(v); setDirty(true); } }}
                    className="rounded-[8px] px-2.5 py-1 text-[13px] text-muted aria-checked:bg-surface aria-checked:font-semibold aria-checked:text-text aria-checked:shadow-1">{t(band as "low")}</button>)}
                </div>
              </Prop>
              <Prop icon="calendar" label={t("due")}><input name="due" type="date" defaultValue={task.due ?? ""} disabled={!writer} aria-label={t("due")} className="field" /></Prop>
              <Prop icon="repeat" label={t("repeat")}>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted">{t("every")}</span>
                  <input name="repeat_every" type="number" min={1} max={365} defaultValue={task.repeat?.every ?? 1} disabled={!writer} aria-label={t("every")} className="field w-[70px]" />
                  <select name="repeat_unit" defaultValue={task.repeat?.unit ?? ""} disabled={!writer} aria-label={t("repeat")} className="field">
                    <option value="">{t("noRepeat")}</option><option value="day">{t("days")}</option><option value="week">{t("weeks")}</option><option value="month">{t("months")}</option>
                  </select>
                </div>
              </Prop>
              <Prop icon="user" label={t("assignee")}><select name="assignee" defaultValue={task.assignee ?? ""} disabled={!writer} aria-label={t("assignee")} className="field"><option value="">{t("nobody")}</option>{members.map((m) => <option key={m.subject} value={m.subject}>{m.display ?? m.subject}</option>)}</select></Prop>
              {labels.length > 0 && <Prop icon="tag" label={t("labels")}><div className="flex flex-wrap gap-1.5">{labels.map((l) => <label key={l.id} className="inline-flex items-center gap-1 rounded-chip border border-line px-2 py-0.5 text-xs"><input type="checkbox" name="label" value={l.id} defaultChecked={task.labels.includes(l.id)} disabled={!writer} /><span dir="auto">{l.name}</span></label>)}</div></Prop>}
              {(project.attributes ?? []).map((a) => (
                <Prop key={a.key} icon="page" label={a.label}>
                  {a.type === "boolean" ? <input type="checkbox" name={"custom." + a.key} defaultChecked={!!custom0[a.key]} disabled={!writer} />
                    : a.type === "choice" ? <select name={"custom." + a.key} defaultValue={String(custom0[a.key] ?? "")} disabled={!writer} className="field"><option value="" />{(a.choices ?? []).map((c) => <option key={c}>{c}</option>)}</select>
                    : <input name={"custom." + a.key} type={a.type === "number" ? "number" : a.type === "date" ? "date" : "text"} defaultValue={String(custom0[a.key] ?? "")} disabled={!writer} className="field" />}
                </Prop>
              ))}
            </div>
            <h3 className="mb-1.5 mt-5 text-[13px] font-semibold text-muted">{t("description")}</h3>
            <LegacyEditor doc={(task.description as EditorJson | null) ?? null} version={task.rev} editable={writer} lang={lang} blocks={blocks} placeholder={t("writeHere")} onChange={(d) => { description.current = d; setDirty(true); }} />
            {!task.parent && (
              <>
                <h3 className="mb-1.5 mt-5 flex items-center gap-1.5 text-[13px] font-semibold text-muted"><Icon name="subtask" className="size-3.5" />{t("subtasks")}{subtasks.length > 0 && <span className="rounded-chip border border-line px-1.5 text-xs">{done}/{subtasks.length}</span>}</h3>
                {subtasks.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 py-1"><input type="checkbox" checked={!!s.completed_at} disabled={!writer} onChange={() => toggleSub(s)} aria-label={s.title} /><span className={cn(!!s.completed_at && "text-muted line-through")} dir="auto">{s.title}</span></label>
                ))}
                {writer && <SubAdd onAdd={addSub} label={t("subtasks")} placeholder={t("addPh")} />}
              </>
            )}
          </div>
          <div hidden={tab !== "a"}><Suspense fallback={<SkeletonLines rows={4} />}><Activity project={project.id} target={{ type: "tasks.task", id: task.id }} writer={writer} /></Suspense></div>
        </div>
        {writer && dirty && (
          <div className="flex items-center gap-2 border-t border-line bg-surface px-3 py-2.5">
            <span className="grow text-[13px] text-muted">{error ?? t("unsaved")}</span>
            <Button kind="ghost" onClick={() => { setDirty(false); description.current = null; void refresh(); }}>{t("discard")}</Button>
            <Button kind="primary" icon="check" type="submit" disabled={pending}>{t("save")}</Button>
          </div>
        )}
      </form>
    </aside>
  );
}

function Prop({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[104px_1fr] items-center gap-2.5"><div className="flex items-center gap-2 text-[13px] text-muted"><Icon name={icon} className="size-3.5" />{label}</div><div>{children}</div></div>;
}

function SubAdd({ onAdd, label, placeholder }: { onAdd: (title: string) => void; label: string; placeholder: string }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); const i = e.currentTarget.elements.namedItem("sub") as HTMLInputElement; const v = i.value.trim(); if (v) { onAdd(v); i.value = ""; } }} className="mt-1.5">
      <input name="sub" type="text" dir="auto" aria-label={label} placeholder={placeholder} className="field w-full" />
    </form>
  );
}
