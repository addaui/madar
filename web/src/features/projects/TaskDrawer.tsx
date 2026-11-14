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
import { Checkbox } from "../../ui/Check";
import { DateField } from "../../ui/DateField";
import { NumberField, TextField } from "../../ui/Field";
import { Segmented } from "../../ui/Segmented";
import { Select } from "../../ui/Select";
import { Tabs } from "../../ui/Tabs";
import { Icon } from "../../ui/Icon";
import { askConfirm, openMenuFrom } from "../../ui/overlays";
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
  const [due, setDue] = useState(task.due ?? "");
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
    <aside aria-label={task.title} className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface workspace:rounded-none workspace:border-0 workspace:bg-transparent">
      <form action={save} onInput={() => setDirty(true)} onChange={() => setDirty(true)} className="flex min-h-0 flex-1 flex-col" key={task.rev}>
        <div className="flex items-center gap-1.5 border-b border-line px-3 py-2.5">
          <TextField bare name="title" defaultValue={task.title} isDisabled={!writer} maxLength={200} label={t("title")} dir="auto" className="min-w-0 flex-1" inputClassName="text-lg font-semibold" onChange={() => setDirty(true)} />
          {writer && <IconButton icon="more" label={t("more")} onPress={(e) => { openMenuFrom(e.target, [{ label: task.archived ? t("restore") : t("archive"), icon: "archive", onclick: archive }, "-", { label: t("delete"), icon: "trash", danger: true, onclick: () => void remove() }]); }} />}
          <IconButton icon="close" label={t("close") + " (Esc)"} onPress={onClose} />
        </div>
        <Tabs variant="compact" label={t("taskDetails")} selected={tab} onSelect={(k) => setTab(k as "d" | "a")} items={[{ id: "d", label: t("tabDetails") }, { id: "a", label: t("activityTab") }]}
          className="flex min-h-0 flex-1 flex-col" panelClassName="min-h-0 flex-1 overflow-auto p-4 data-[inert]:hidden"
          panels={{
            d: (
              <>
            {code && <div className="mb-2"><CopyCode code={code} /></div>}
            <div className="grid gap-2.5">
              <Prop icon="task" label={t("status")}><Select name="status" label={t("status")} defaultValue={task.status} isDisabled={!writer} onChange={() => setDirty(true)} options={project.statuses.map((x) => ({ value: x.id, label: x.name }))} /></Prop>
              <Prop icon="flag" label={t("priority")}>
                <Segmented label={t("priority")} value={bandOf(priority)} isDisabled={!writer} onChange={(band) => { const v = BANDS.find(([b2]) => b2 === band)?.[1]; if (v !== undefined && bandOf(priority) !== band) { setPriority(v); setDirty(true); } }} options={BANDS.map(([band]) => ({ value: band, label: t(band as "low") }))} />
              </Prop>
              <Prop icon="calendar" label={t("due")}><DateField name="due" label={t("due")} value={due} onChange={(v) => { setDue(v); setDirty(true); }} isDisabled={!writer} /></Prop>
              <Prop icon="repeat" label={t("repeat")}>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted">{t("every")}</span>
                  <NumberField name="repeat_every" label={t("every")} minValue={1} maxValue={365} defaultValue={task.repeat?.every ?? 1} isDisabled={!writer} onChange={() => setDirty(true)} className="w-[84px]" />
                  <Select name="repeat_unit" label={t("repeat")} defaultValue={task.repeat?.unit ?? ""} isDisabled={!writer} onChange={() => setDirty(true)} options={[{ value: "", label: t("noRepeat") }, { value: "day", label: t("days") }, { value: "week", label: t("weeks") }, { value: "month", label: t("months") }]} />
                </div>
              </Prop>
              <Prop icon="user" label={t("assignee")}><Select name="assignee" label={t("assignee")} defaultValue={task.assignee ?? ""} isDisabled={!writer} onChange={() => setDirty(true)} options={[{ value: "", label: t("nobody") }, ...members.map((m) => ({ value: m.subject, label: m.display ?? m.subject }))]} /></Prop>
              {labels.length > 0 && <Prop icon="tag" label={t("labels")}><div className="flex flex-wrap gap-1.5">{labels.map((l) => <Checkbox key={l.id} name="label" value={l.id} defaultSelected={task.labels.includes(l.id)} isDisabled={!writer} onChange={() => setDirty(true)} className="rounded-chip border border-line px-2 py-0.5 text-xs"><span dir="auto">{l.name}</span></Checkbox>)}</div></Prop>}
              {(project.attributes ?? []).map((a) => (
                <Prop key={a.key} icon="page" label={a.label}>
                  {a.type === "boolean" ? <Checkbox name={"custom." + a.key} aria-label={a.label} defaultSelected={!!custom0[a.key]} isDisabled={!writer} onChange={() => setDirty(true)} />
                    : a.type === "choice" ? <Select name={"custom." + a.key} label={a.label} defaultValue={String(custom0[a.key] ?? "")} isDisabled={!writer} onChange={() => setDirty(true)} options={[{ value: "", label: "—" }, ...(a.choices ?? []).map((c) => ({ value: c, label: c }))]} />
                    : a.type === "date" ? <AttrDate name={"custom." + a.key} label={a.label} initial={String(custom0[a.key] ?? "")} disabled={!writer} onChange={() => setDirty(true)} />
                    : a.type === "number" ? <NumberField name={"custom." + a.key} label={a.label} defaultValue={custom0[a.key] === undefined || custom0[a.key] === null ? undefined : Number(custom0[a.key])} isDisabled={!writer} onChange={() => setDirty(true)} />
                    : <TextField name={"custom." + a.key} label={a.label} defaultValue={String(custom0[a.key] ?? "")} isDisabled={!writer} onChange={() => setDirty(true)} />}
                </Prop>
              ))}
            </div>
            <h3 className="mb-1.5 mt-5 text-[13px] font-semibold text-muted">{t("description")}</h3>
            <LegacyEditor doc={(task.description as EditorJson | null) ?? null} version={task.rev} editable={writer} lang={lang} blocks={blocks} project={project.id} placeholder={t("writeHere")} onChange={(d) => { description.current = d; setDirty(true); }} />
            {!task.parent && (
              <>
                <h3 className="mb-1.5 mt-5 flex items-center gap-1.5 text-[13px] font-semibold text-muted"><Icon name="subtask" className="size-3.5" />{t("subtasks")}{subtasks.length > 0 && <span className="rounded-chip border border-line px-1.5 text-xs">{done}/{subtasks.length}</span>}</h3>
                {subtasks.map((s) => (
                  <Checkbox key={s.id} className="py-1" isSelected={!!s.completed_at} isDisabled={!writer} onChange={() => toggleSub(s)}><span className={cn(!!s.completed_at && "text-muted line-through")} dir="auto">{s.title}</span></Checkbox>
                ))}
                {writer && <SubAdd onAdd={addSub} label={t("subtasks")} placeholder={t("addPh")} />}
              </>
            )}
              </>
            ),
            a: <Suspense fallback={<SkeletonLines rows={4} />}><Activity project={project.id} target={{ type: "tasks.task", id: task.id }} writer={writer} /></Suspense>,
          }} />
        {writer && dirty && (
          <div className="flex items-center gap-2 border-t border-line bg-surface px-3 py-2.5">
            <span className="grow text-[13px] text-muted">{error ?? t("unsaved")}</span>
            <Button kind="ghost" onPress={() => { setDirty(false); description.current = null; void refresh(); }}>{t("discard")}</Button>
            <Button kind="primary" icon="check" type="submit" isDisabled={pending}>{t("save")}</Button>
          </div>
        )}
      </form>
    </aside>
  );
}

function Prop({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[104px_1fr] items-center gap-2.5"><div className="flex items-center gap-2 text-[13px] text-muted"><Icon name={icon} className="size-3.5" />{label}</div><div>{children}</div></div>;
}

/** A date attribute of the project, kept as the form's value ("YYYY-MM-DD" or empty). */
function AttrDate({ name, label, initial, disabled, onChange }: { name: string; label: string; initial: string; disabled: boolean; onChange: () => void }) {
  const [v, setV] = useState(initial);
  return <DateField name={name} label={label} value={v} isDisabled={disabled} onChange={(x) => { setV(x); onChange(); }} />;
}

function SubAdd({ onAdd, label, placeholder }: { onAdd: (title: string) => void; label: string; placeholder: string }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget, v = String(new FormData(form).get("sub") ?? "").trim(); if (v) { onAdd(v); form.reset(); } }} className="mt-1.5">
      <TextField name="sub" dir="auto" label={label} placeholder={placeholder} />
    </form>
  );
}
